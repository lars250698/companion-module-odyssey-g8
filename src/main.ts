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

export class ModuleInstance extends InstanceBase<ModuleConfig> {
	config!: ModuleConfig // Setup in init()
	smartThingsClient!: SmartThingsClient
	devices: Device[] = []
	state: Map<string, DeviceStatus> = new Map()

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		await this.configUpdated(config)
	}
	// When module gets deleted
	async destroy(): Promise<void> {
		this.log('debug', 'destroy')
	}

	async getState(): Promise<void> {
		for (const device of this.devices) {
			const state: DeviceStatus = await this.smartThingsClient.devices.getStatus(device.deviceId)
			this.state.set(device.deviceId, state)
		}
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.devices = []

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
			await this.getState()
			this.updateStatus(InstanceStatus.Ok)
		} else {
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
}

runEntrypoint(ModuleInstance, UpgradeScripts)
