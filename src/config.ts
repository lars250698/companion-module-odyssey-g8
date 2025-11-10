import { type SomeCompanionConfigField } from '@companion-module/base'

export interface ModuleConfig {
	clientId: string
	clientSecret: string
	scopes: string
	authUrl: string
	accessToken: string
	refreshToken: string
	tokenExpiry: string
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{ type: 'textinput', id: 'clientId', label: 'SmartThings Client ID', width: 6, required: true },
		{ type: 'textinput', id: 'clientSecret', label: 'SmartThings Client Secret', width: 6, required: true },
		{ type: 'textinput', id: 'scopes', label: 'Scopes', default: 'r:devices:* x:devices:*', width: 12 },
		// shows the URL user must open in a browser to authorize
		{ type: 'textinput', id: 'authUrl', label: 'Authorize URL (open this)', width: 12 },
		// hidden/persisted after success:
		{ type: 'static-text', id: 'accessToken', label: 'Access Token', width: 12, value: '' },
		{ type: 'static-text', id: 'refreshToken', label: 'Refresh Token', width: 12, value: '' },
		{ type: 'static-text', id: 'tokenExpiry', label: 'Token Expiry (epoch)', width: 12, value: '' },
	]
}
