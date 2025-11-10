import { SomeCompanionActionInputField } from '@companion-module/base'
import type { ModuleInstance } from './main.js'
import { sleep, refresh } from './helpers.js'
import { CapabilityStatus, DeviceStatus } from '@smartthings/core-sdk'

export function UpdateActions(self: ModuleInstance): void {
	const deviceIdDropdownOption: SomeCompanionActionInputField = {
		id: 'deviceId',
		type: 'dropdown',
		label: 'Device',
		choices: self.devices.map((device) => ({
			id: device.deviceId,
			label: device.name ?? device.presentationId,
		})),
		default: self.devices[0]?.deviceId ?? '',
	}

	self.setActionDefinitions({
		select_input: {
			name: 'Select input',
			options: [
				deviceIdDropdownOption,
				{
					id: 'input',
					type: 'textinput',
					label: 'Input',
					default: 'HDMI',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const input = event.options.input
				if (!input || typeof input !== 'string') {
					throw new Error()
				}
				await self.smartThingsClient.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'samsungvd.mediaInputSource',
					command: 'setInputSource',
					arguments: [input],
				})
				await sleep(1500)
				self.checkFeedbacks('InputState')
			},
		},
		powerToggle: {
			name: 'Toggle Power',
			options: [deviceIdDropdownOption],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const status: CapabilityStatus = await self.smartThingsClient.devices.getCapabilityStatus(
					deviceId,
					'main',
					'switch',
				)
				const isOn = status?.['switch']?.['value'] === 'on'
				const command = isOn ? 'off' : 'on'
				await self.smartThingsClient.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'switch',
					command: command,
				})
				await sleep(3000)
				self.checkFeedbacks('PowerState')
			},
		},
		power: {
			name: 'Set Power',
			options: [
				deviceIdDropdownOption,
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: [
						{
							id: 'on',
							label: 'on',
						},
						{
							id: 'off',
							label: 'off',
						},
					],
					default: 'on',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const state = event.options.state
				if (!state || typeof state !== 'string') {
					throw new Error()
				}
				await self.smartThingsClient.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'switch',
					command: state,
				})
				await sleep(4000)
				self.checkFeedbacks('PowerState')
			},
		},
		volume: {
			name: 'Volume',
			options: [
				deviceIdDropdownOption,
				{
					id: 'action',
					type: 'dropdown',
					label: 'Action',
					choices: [
						{
							id: 'volumeUp',
							label: 'Volume up',
						},
						{
							id: 'volumeDown',
							label: 'Volume down',
						},
					],
					default: 'volumeUp',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const action = event.options.action
				if (!action || typeof action !== 'string') {
					throw new Error()
				}
				await self.smartThingsClient.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'audioVolume',
					command: action,
				})
				await sleep(3000)
				self.checkFeedbacks('AudioVolume')
			},
		},
		muteToggle: {
			name: 'Toggle Mute',
			options: [deviceIdDropdownOption],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				await refresh(self, deviceId)
				const status: DeviceStatus = await self.smartThingsClient.devices.getStatus(deviceId)
				const isMute = status?.components?.['main']?.['audioMute']?.['mute']?.['value'] === 'muted'
				const state = isMute ? 'unmuted' : 'muted'
				await self.smartThingsClient.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'audioMute',
					command: 'setMute',
					arguments: [state],
				})
				await sleep(2000)
				self.checkFeedbacks('MuteState')
			},
		},
		mute: {
			name: 'Mute',
			options: [
				deviceIdDropdownOption,
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					choices: [
						{
							id: 'muted',
							label: 'muted',
						},
						{
							id: 'unmuted',
							label: 'unmuted',
						},
					],
					default: 'muted',
				},
			],
			callback: async (event) => {
				const deviceId = event.options.deviceId
				if (!deviceId || typeof deviceId !== 'string') {
					throw new Error()
				}
				const state = event.options.state
				if (!state || typeof state !== 'string') {
					throw new Error()
				}
				await self.smartThingsClient.devices.executeCommand(deviceId, {
					component: 'main',
					capability: 'audioMute',
					command: 'setMute',
					arguments: [state],
				})
				await sleep(4000)
				self.checkFeedbacks('MuteState')
			},
		},
	})
}
