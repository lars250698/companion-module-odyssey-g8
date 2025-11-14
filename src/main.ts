import {
	InstanceBase,
	runEntrypoint,
	InstanceStatus,
	SomeCompanionConfigField,
	CompanionHTTPRequest,
	CompanionHTTPResponse,
	CompanionVariableValues,
} from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions } from './actions.js'
import { UpdateFeedbacks } from './feedbacks.js'
import { Device, DeviceStatus, RefreshTokenAuthenticator, SmartThingsClient } from '@smartthings/core-sdk'
import qs from 'querystring'
import { DeviceStateManager, type DeviceStateHost } from './state-manager.js'

export class ModuleInstance extends InstanceBase<ModuleConfig> implements DeviceStateHost {
	config!: ModuleConfig // Setup in init()
	smartThingsClient: SmartThingsClient | undefined
	devices: Device[] = []
	readonly stateManager: DeviceStateManager

	constructor(internal: unknown) {
		super(internal)
		this.stateManager = new DeviceStateManager(this)
	}

	async init(config: ModuleConfig): Promise<void> {
		await this.configUpdated(config)
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		this.stateManager.clearAllDeviceState()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		const normalizedInterval = this.stateManager.setPollInterval(this.config.pollInterval)
		this.config.pollInterval = normalizedInterval

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
			this.stateManager.pruneDeviceStateForKnownDevices()
			this.updateStatus(InstanceStatus.Ok)
		} else {
			this.smartThingsClient = undefined
			this.devices = []
			this.stateManager.clearAllDeviceState()
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
		this.updateAllDeviceVariableValues()
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
		this.stateManager.subscribeDeviceState(deviceId)
	}

	unsubscribeDeviceState(deviceId?: string): void {
		this.stateManager.unsubscribeDeviceState(deviceId)
	}

	getCachedDeviceState(deviceId: string): DeviceStatus | undefined {
		return this.stateManager.getCachedDeviceState(deviceId)
	}

	requestDeviceRefresh(deviceId: string, forceFeedbackUpdate = false): void {
		this.stateManager.requestDeviceRefresh(deviceId, forceFeedbackUpdate)
	}

	getSmartThingsClient(): SmartThingsClient {
		if (!this.smartThingsClient) {
			throw new Error('SmartThings client is not initialized')
		}
		return this.smartThingsClient
	}

	getDeviceVariableBaseId(deviceId: string): string {
		const sanitized = deviceId.replace(/[^A-Za-z0-9_]/g, '_')
		return `device_${sanitized}`
	}

	getDeviceDisplayName(deviceId: string): string {
		const device = this.devices.find((d) => d.deviceId === deviceId)
		return device?.name || (device as { label?: string } | undefined)?.label || device?.presentationId || deviceId
	}

	async getDeviceStateSnapshot(deviceId: string, forceRefresh = false): Promise<DeviceStatus | undefined> {
		return this.stateManager.getDeviceStateSnapshot(deviceId, forceRefresh)
	}

	optimisticSetAttribute(
		deviceId: string,
		componentId: string,
		capabilityId: string,
		attributeId: string,
		value: unknown,
		extraFields?: Record<string, unknown>,
	): void {
		this.stateManager.optimisticSetAttribute(deviceId, componentId, capabilityId, attributeId, value, extraFields)
	}

	updateDeviceVariableValues(deviceId: string): void {
		if (!this.isKnownDevice(deviceId)) return
		const ids = this.getDeviceVariableIds(deviceId)
		const status = this.stateManager.getCachedDeviceState(deviceId)
		const powerValue = this.formatAttributeValue(status?.components?.['main']?.['switch']?.['switch']?.['value'])
		const inputValue = this.formatAttributeValue(
			status?.components?.['main']?.['samsungvd.mediaInputSource']?.['inputSource']?.['value'],
		)
		const muteValue = this.formatAttributeValue(status?.components?.['main']?.['audioMute']?.['mute']?.['value'])
		const volumeAttribute = status?.components?.['main']?.['audioVolume']?.['volume']
		const volumeValue = volumeAttribute?.value as number

		const values: CompanionVariableValues = {
			[ids.power]: powerValue,
			[ids.input]: inputValue,
			[ids.mute]: muteValue,
			[ids.volume]: volumeValue,
		}
		this.setVariableValues(values)
	}

	updateAllDeviceVariableValues(): void {
		for (const device of this.devices) {
			this.updateDeviceVariableValues(device.deviceId)
		}
	}

	private getDeviceVariableIds(deviceId: string): { power: string; input: string; mute: string; volume: string } {
		const base = this.getDeviceVariableBaseId(deviceId)
		return {
			power: `${base}_power`,
			input: `${base}_input`,
			mute: `${base}_mute`,
			volume: `${base}_volume`,
		}
	}

	private clearDeviceVariableValues(deviceId: string): void {
		const ids = this.getDeviceVariableIds(deviceId)
		this.setVariableValues({
			[ids.power]: '',
			[ids.input]: '',
			[ids.mute]: '',
			[ids.volume]: '',
		})
	}

	isKnownDevice(deviceId: string): boolean {
		return this.devices.some((device) => device.deviceId === deviceId)
	}

	private formatAttributeValue(value: unknown): string {
		if (typeof value === 'string') return value
		if (typeof value === 'number' || typeof value === 'boolean') return String(value)
		return ''
	}

	private refreshFeedbacksFromState(): void {
		this.checkFeedbacks('PowerState', 'InputState', 'MuteState', 'AudioVolume')
	}

	handleDeviceStateUpdated(deviceId: string, options?: { changed?: boolean; forceFeedback?: boolean }): void {
		this.updateDeviceVariableValues(deviceId)
		if (options?.changed || options?.forceFeedback) {
			this.refreshFeedbacksFromState()
		}
	}

	handleDeviceStateCleared(deviceId: string): void {
		this.clearDeviceVariableValues(deviceId)
		this.refreshFeedbacksFromState()
	}

	handleAllDeviceStatesCleared(): void {
		for (const device of this.devices) {
			this.clearDeviceVariableValues(device.deviceId)
		}
		this.refreshFeedbacksFromState()
	}
}

runEntrypoint(ModuleInstance, UpgradeScripts)
