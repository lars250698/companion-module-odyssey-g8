import type { SmartThingsClient, DeviceStatus } from '@smartthings/core-sdk'

type DeviceStateEntry = {
	refCount: number
	status?: DeviceStatus
	serialized?: string
	timer?: NodeJS.Timeout
	refreshPromise?: Promise<void>
	backoffMs: number
	suppressUpdatesUntil?: number
}

const DEFAULT_POLL_MS = 10000
const MIN_POLL_MS = 1000
const MAX_BACKOFF_MS = 60000
const OPTIMISTIC_SUPPRESS_MS = 10000

export interface DeviceStateHost {
	log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void
	getSmartThingsClient(): SmartThingsClient | undefined
	isKnownDevice(deviceId: string): boolean
	handleDeviceStateUpdated(deviceId: string, options?: { changed?: boolean; forceFeedback?: boolean }): void
	handleDeviceStateCleared(deviceId: string): void
	handleAllDeviceStatesCleared(): void
}

export class DeviceStateManager {
	private readonly deviceState: Map<string, DeviceStateEntry> = new Map()
	private pollIntervalMs = DEFAULT_POLL_MS

	constructor(private readonly host: DeviceStateHost) {}

	setPollInterval(value: unknown): number {
		const normalized = this.normalizePollInterval(value)
		if (normalized !== this.pollIntervalMs) {
			this.pollIntervalMs = normalized
			this.rescheduleDevicePolling()
		}
		return this.pollIntervalMs
	}

	getPollInterval(): number {
		return this.pollIntervalMs
	}

	clearAllDeviceState(): void {
		for (const entry of this.deviceState.values()) {
			if (entry.timer) {
				clearTimeout(entry.timer)
			}
		}
		this.deviceState.clear()
		this.host.handleAllDeviceStatesCleared()
	}

	pruneDeviceStateForKnownDevices(): void {
		for (const [deviceId, entry] of this.deviceState.entries()) {
			if (!this.host.isKnownDevice(deviceId)) {
				if (entry.timer) {
					clearTimeout(entry.timer)
				}
				this.deviceState.delete(deviceId)
				this.host.handleDeviceStateCleared(deviceId)
			}
		}
	}

	subscribeDeviceState(deviceId?: string): void {
		if (!deviceId || typeof deviceId !== 'string') return
		if (!this.host.getSmartThingsClient()) return
		if (!this.host.isKnownDevice(deviceId)) {
			this.host.log('warn', `Attempted to subscribe unknown device ${deviceId}`)
			return
		}
		const entry = this.ensureDeviceStateEntry(deviceId)
		entry.refCount += 1
		if (entry.refCount === 1) {
			this.refreshDeviceState(deviceId, true).catch((err) => {
				this.host.log('error', `Initial device refresh failed for ${deviceId}: ${String(err)}`)
			})
		}
	}

	unsubscribeDeviceState(deviceId?: string): void {
		if (!deviceId || typeof deviceId !== 'string') return
		const entry = this.deviceState.get(deviceId)
		if (!entry) return
		entry.refCount = Math.max(0, entry.refCount - 1)
		if (entry.refCount === 0) {
			if (entry.timer) {
				clearTimeout(entry.timer)
			}
			this.deviceState.delete(deviceId)
			this.host.handleDeviceStateCleared(deviceId)
		}
	}

	getCachedDeviceState(deviceId: string): DeviceStatus | undefined {
		return this.deviceState.get(deviceId)?.status
	}

	requestDeviceRefresh(deviceId: string, forceFeedbackUpdate = false): void {
		const entry = this.deviceState.get(deviceId)
		if (!entry) return
		this.refreshDeviceState(deviceId, forceFeedbackUpdate).catch((err) => {
			this.host.log('error', `Manual device refresh failed for ${deviceId}: ${String(err)}`)
		})
	}

	async getDeviceStateSnapshot(deviceId: string, forceRefresh = false): Promise<DeviceStatus | undefined> {
		if (!this.host.isKnownDevice(deviceId)) return undefined
		const entry = this.ensureDeviceStateEntry(deviceId)
		if (forceRefresh || !entry.status) {
			const pending = forceRefresh || !entry.status ? this.refreshDeviceState(deviceId, true) : entry.refreshPromise
			if (pending) {
				await pending
			}
		}
		return entry.status
	}

	optimisticSetAttribute(
		deviceId: string,
		componentId: string,
		capabilityId: string,
		attributeId: string,
		value: unknown,
		extraFields?: Record<string, unknown>,
	): void {
		this.optimisticUpdateDeviceState(deviceId, (status) => {
			const components = (status.components ??= {} as Record<string, any>)
			const component = (components[componentId] ??= {} as Record<string, any>)
			const capability = (component[capabilityId] ??= {} as Record<string, any>)
			const attribute = (capability[attributeId] ??= {} as Record<string, any>)
			attribute.value = value
			if (extraFields) {
				for (const [key, val] of Object.entries(extraFields)) {
					attribute[key] = val
				}
			}
		})
	}

	private normalizePollInterval(value: unknown): number {
		const numeric = typeof value === 'number' && !Number.isNaN(value) ? value : DEFAULT_POLL_MS
		return Math.min(Math.max(numeric, MIN_POLL_MS), MAX_BACKOFF_MS)
	}

	private ensureDeviceStateEntry(deviceId: string): DeviceStateEntry {
		let entry = this.deviceState.get(deviceId)
		if (!entry) {
			entry = { refCount: 0, backoffMs: this.getPollInterval() }
			this.deviceState.set(deviceId, entry)
		}
		return entry
	}

	private scheduleNextDeviceRefresh(deviceId: string, entry: DeviceStateEntry): void {
		if (entry.timer) {
			clearTimeout(entry.timer)
		}
		const base = entry.backoffMs || this.getPollInterval()
		const jitterWindow = Math.min(1000, Math.floor(base * 0.1))
		const delay = base + Math.floor(Math.random() * (jitterWindow + 1))
		entry.timer = setTimeout(() => {
			this.refreshDeviceState(deviceId).catch((err) => {
				this.host.log('error', `Scheduled device refresh failed for ${deviceId}: ${String(err)}`)
			})
		}, delay)
	}

	private async refreshDeviceState(deviceId: string, forceFeedbackUpdate = false): Promise<void> {
		const entry = this.deviceState.get(deviceId)
		const client = this.host.getSmartThingsClient()
		if (!entry || !client) return
		if (entry.refreshPromise) return entry.refreshPromise
		const promise = (async () => {
			try {
				await client.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'refresh',
					command: 'refresh',
				})
				const status = await client.devices.getStatus(deviceId)
				const now = Date.now()
				if (entry.suppressUpdatesUntil && now < entry.suppressUpdatesUntil) {
					const delay = Math.max(entry.suppressUpdatesUntil - now, MIN_POLL_MS)
					entry.backoffMs = delay
					return
				}
				const serialized = JSON.stringify(status)
				const changed = entry.serialized !== serialized
				entry.status = status
				entry.serialized = serialized
				entry.backoffMs = this.getPollInterval()
				entry.suppressUpdatesUntil = undefined
				if (changed || forceFeedbackUpdate) {
					this.host.handleDeviceStateUpdated(deviceId, { changed, forceFeedback: forceFeedbackUpdate })
				}
			} catch (err) {
				const current = entry.backoffMs || this.getPollInterval()
				entry.backoffMs = Math.min(current * 2, MAX_BACKOFF_MS)
				this.host.log('error', `Failed to get status for ${deviceId}: ${String(err)}`)
			} finally {
				entry.refreshPromise = undefined
				if (entry.refCount > 0) {
					this.scheduleNextDeviceRefresh(deviceId, entry)
				} else {
					if (entry.timer) {
						clearTimeout(entry.timer)
					}
					this.deviceState.delete(deviceId)
					this.host.handleDeviceStateCleared(deviceId)
				}
			}
		})()
		entry.refreshPromise = promise
		return promise
	}

	private optimisticUpdateDeviceState(deviceId: string, mutator: (status: DeviceStatus) => void): void {
		const entry = this.ensureDeviceStateEntry(deviceId)
		const base: DeviceStatus = entry.status
			? (JSON.parse(JSON.stringify(entry.status)) as DeviceStatus)
			: ({ components: {} } as DeviceStatus)
		try {
			mutator(base)
		} catch (err) {
			this.host.log('debug', `Optimistic update failed for ${deviceId}: ${String(err)}`)
			return
		}
		entry.status = base
		entry.serialized = JSON.stringify(base)
		entry.suppressUpdatesUntil = Date.now() + OPTIMISTIC_SUPPRESS_MS
		this.host.handleDeviceStateUpdated(deviceId, { changed: true, forceFeedback: true })
	}

	private rescheduleDevicePolling(): void {
		for (const [deviceId, entry] of this.deviceState.entries()) {
			entry.backoffMs = this.getPollInterval()
			if (entry.refCount > 0) {
				this.scheduleNextDeviceRefresh(deviceId, entry)
			}
		}
	}
}

export const POLLING_CONSTANTS = {
	DEFAULT_POLL_MS,
	MIN_POLL_MS,
	MAX_BACKOFF_MS,
	OPTIMISTIC_SUPPRESS_MS,
}
