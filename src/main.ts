import {
	InstanceBase,
	runEntrypoint,
	InstanceStatus,
	SomeCompanionConfigField,
	CompanionHTTPRequest,
	CompanionHTTPResponse,
} from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { Device, DeviceStatus, RefreshTokenAuthenticator, SmartThingsClient } from '@smartthings/core-sdk'
import qs from 'querystring'
import { refresh } from './helpers.js'

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
const OPTIMISTIC_SUPPRESS_MS = 4000

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig // Setup in init()
	smartThingsClient: SmartThingsClient | undefined
	devices: Device[] = []
	deviceState: Map<string, DeviceStateEntry> = new Map()
	pollIntervalMs = DEFAULT_POLL_MS

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		await this.configUpdated(config)
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		this.clearAllDeviceState()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		const newInterval = this.normalizePollInterval(this.config.pollInterval)
		const intervalChanged = newInterval !== this.pollIntervalMs
		this.pollIntervalMs = newInterval
		this.config.pollInterval = newInterval
		if (intervalChanged) {
			this.rescheduleDevicePolling()
		}

		const redirect = encodeURIComponent('https://bitfocus.github.io/companion-oauth/callback')
		const scope = encodeURIComponent((config.scopes || '').replace(/\s+/g, ' '))
		const authUrl =
			`https://api.smartthings.com/oauth/authorize?response_type=code` +
			`&client_id=${encodeURIComponent(config.clientId)}` +
			`&redirect_uri=${redirect}` +
			`&scope=${scope}` +
			`&state=${encodeURIComponent(this.id)}`
		this.config.authUrl = authUrl
		this.saveConfig(this.config)
		this.log('info', `Open this URL to authorize: ${authUrl}`)

		if (this.config.refreshToken && this.config.refreshToken && this.config.clientId && this.config.clientSecret) {
			const authenticator = new RefreshTokenAuthenticator(this.config.accessToken, {
				getRefreshData: async () => ({
					refreshToken: this.config.refreshToken,
					clientId: this.config.clientId,
					clientSecret: this.config.clientSecret,
				}),
				putAuthData: async (data) => {
					this.config.accessToken = data.authToken
					this.config.refreshToken = data.refreshToken
					this.saveConfig(this.config)
				},
			})
			this.smartThingsClient = new SmartThingsClient(authenticator)
			this.devices = await this.smartThingsClient.devices.list()
			this.pruneDeviceStateForKnownDevices()
			this.updateStatus(InstanceStatus.Ok)
		} else {
			this.smartThingsClient = undefined
			this.devices = []
			this.clearAllDeviceState()
			this.updateStatus(InstanceStatus.AuthenticationFailure)
		}

		this.updateActions() // export actions
		this.updateFeedbacks() // export feedbacks
		this.updateVariableDefinitions() // export variable definitions
	}

	// Return config fields for web config
	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}

	async handleHttpRequest(req: CompanionHTTPRequest): Promise<CompanionHTTPResponse> {
		if (req.path === '/oauth/callback') {
			const code = req.query['code']
			if (!code) {
				return { status: 400, body: 'Missing/invalid auth code or state' }
			}
			if (!this.config.clientId || !this.config.clientSecret) {
				return { status: 400, body: 'Missing client credentials' }
			}

			try {
				const body = qs.stringify({
					grant_type: 'authorization_code',
					code,
					redirect_uri: 'https://bitfocus.github.io/companion-oauth/callback',
				})

				const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64')
				const r = await fetch('https://api.smartthings.com/oauth/token', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						Authorization: `Basic ${basic}`,
					},
					body,
				})
				if (!r.ok) throw new Error(`token exchange failed: ${r.status}`)
				const tok = await r.json()
				let token
				if (typeof tok === 'object') {
					token = tok as { access_token: string; refresh_token: string; expires_in: number }
				}

				this.config.accessToken = token?.access_token ?? ''
				this.config.refreshToken = token?.refresh_token ?? ''
				this.config.tokenExpiry = `${Math.floor(Date.now() / 1000) + (token?.expires_in ?? 0)}`
				this.saveConfig(this.config)
				await this.configUpdated(this.config)

				return { status: 200, body: 'SmartThings authentication success.\nYou can close this tab.' }
			} catch (err) {
				this.log('error', `OAuth token exchange failed: ${String(err)}`)
				return { status: 500, body: `Auth failed: ${String(err)}` }
			}
		}
		return { status: 404 }
	}

	subscribeDeviceState(deviceId?: string): void {
		if (!deviceId || typeof deviceId !== 'string') return
		if (!this.smartThingsClient) return
		if (!this.isKnownDevice(deviceId)) {
			this.log('warn', `Attempted to subscribe unknown device ${deviceId}`)
			return
		}
		const entry = this.ensureDeviceStateEntry(deviceId)
		entry.refCount += 1
		if (entry.refCount === 1) {
			this.refreshDeviceState(deviceId, true).catch((err) => {
				this.log('error', `Initial device refresh failed for ${deviceId}: ${String(err)}`)
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
		}
	}

	getCachedDeviceState(deviceId: string): DeviceStatus | undefined {
		return this.deviceState.get(deviceId)?.status
	}

	requestDeviceRefresh(deviceId: string, forceFeedbackUpdate = false): void {
		const entry = this.deviceState.get(deviceId)
		if (!entry) return
		this.refreshDeviceState(deviceId, forceFeedbackUpdate).catch((err) => {
			this.log('error', `Manual device refresh failed for ${deviceId}: ${String(err)}`)
		})
	}

	getSmartThingsClient(): SmartThingsClient {
		if (!this.smartThingsClient) {
			throw new Error('SmartThings client is not initialized')
		}
		return this.smartThingsClient
	}

	async getDeviceStateSnapshot(deviceId: string, forceRefresh = false): Promise<DeviceStatus | undefined> {
		if (!this.smartThingsClient) return undefined
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

	private getConfiguredPollInterval(): number {
		return this.pollIntervalMs
	}

	private isKnownDevice(deviceId: string): boolean {
		return this.devices.some((device) => device.deviceId === deviceId)
	}

	private ensureDeviceStateEntry(deviceId: string): DeviceStateEntry {
		let entry = this.deviceState.get(deviceId)
		if (!entry) {
			entry = { refCount: 0, backoffMs: this.getConfiguredPollInterval() }
			this.deviceState.set(deviceId, entry)
		}
		return entry
	}

	private scheduleNextDeviceRefresh(deviceId: string, entry: DeviceStateEntry): void {
		if (entry.timer) {
			clearTimeout(entry.timer)
		}
		const base = entry.backoffMs || this.getConfiguredPollInterval()
		const jitterWindow = Math.min(1000, Math.floor(base * 0.1))
		const delay = base + Math.floor(Math.random() * (jitterWindow + 1))
		entry.timer = setTimeout(() => {
			this.refreshDeviceState(deviceId).catch((err) => {
				this.log('error', `Scheduled device refresh failed for ${deviceId}: ${String(err)}`)
			})
		}, delay)
	}

	private async refreshDeviceState(deviceId: string, forceFeedbackUpdate = false): Promise<void> {
		const entry = this.deviceState.get(deviceId)
		const client = this.smartThingsClient
		if (!entry || !client) return
		if (entry.refreshPromise) return entry.refreshPromise
		const promise = (async () => {
			try {
				await refresh(this, deviceId)
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
				entry.backoffMs = this.getConfiguredPollInterval()
				entry.suppressUpdatesUntil = undefined
				if (changed || forceFeedbackUpdate) {
					this.refreshFeedbacksFromState()
				}
			} catch (err) {
				const current = entry.backoffMs || this.getConfiguredPollInterval()
				entry.backoffMs = Math.min(current * 2, MAX_BACKOFF_MS)
				this.log('error', `Failed to get status for ${deviceId}: ${String(err)}`)
			} finally {
				entry.refreshPromise = undefined
				if (entry.refCount > 0) {
					this.scheduleNextDeviceRefresh(deviceId, entry)
				} else {
					if (entry.timer) {
						clearTimeout(entry.timer)
					}
					this.deviceState.delete(deviceId)
				}
			}
		})()
		entry.refreshPromise = promise
		return promise
	}

	private rescheduleDevicePolling(): void {
		for (const [deviceId, entry] of this.deviceState.entries()) {
			entry.backoffMs = this.getConfiguredPollInterval()
			if (entry.refCount > 0) {
				this.scheduleNextDeviceRefresh(deviceId, entry)
			}
		}
	}

	private pruneDeviceStateForKnownDevices(): void {
		for (const [deviceId, entry] of this.deviceState.entries()) {
			if (!this.isKnownDevice(deviceId)) {
				if (entry.timer) {
					clearTimeout(entry.timer)
				}
				this.deviceState.delete(deviceId)
			}
		}
	}

	private clearAllDeviceState(): void {
		for (const entry of this.deviceState.values()) {
			if (entry.timer) {
				clearTimeout(entry.timer)
			}
		}
		this.deviceState.clear()
	}

	private refreshFeedbacksFromState(): void {
		this.checkFeedbacks('PowerState', 'InputState', 'MuteState', 'AudioVolume')
	}

	private optimisticUpdateDeviceState(deviceId: string, mutator: (status: DeviceStatus) => void): void {
		const entry = this.ensureDeviceStateEntry(deviceId)
		const base: DeviceStatus = entry.status
			? (JSON.parse(JSON.stringify(entry.status)) as DeviceStatus)
			: ({ components: {} } as DeviceStatus)
		try {
			mutator(base)
		} catch (err) {
			this.log('debug', `Optimistic update failed for ${deviceId}: ${String(err)}`)
			return
		}
		entry.status = base
		entry.serialized = JSON.stringify(base)
		entry.suppressUpdatesUntil = Date.now() + OPTIMISTIC_SUPPRESS_MS
		this.refreshFeedbacksFromState()
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
