import { DeviceStatus } from '@smartthings/core-sdk'
import { ModuleInstance } from './main.js'
import { InputSourceMapEntry } from './types.js'

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function refresh(self: ModuleInstance, deviceId: string): Promise<void> {
	const client = self.getSmartThingsClient()
	await client.devices.executeCommand(deviceId, {
		component: 'main',
		capability: 'refresh',
		command: 'refresh',
	})
}

export function getInputsource(idOrName: string, state?: DeviceStatus): InputSourceMapEntry | undefined {
	const capability = state?.components?.['main']?.['samsungvd.mediaInputSource']
	const inputSourceMap: InputSourceMapEntry[] =
		(capability?.['supportedInputSourcesMap']?.['value'] as InputSourceMapEntry[]) ?? []
	for (const input of inputSourceMap) {
		if (input.id === idOrName || input.name === idOrName) {
			return input
		}
	}
	return undefined
}

export async function getCachedOrLiveDeviceState(
	self: ModuleInstance,
	deviceId: string,
): Promise<DeviceStatus | undefined> {
	if (!self.isKnownDevice(deviceId)) return undefined
	const cached = self.getCachedDeviceState(deviceId)
	if (cached) return cached

	const client = self.getSmartThingsClient()
	return client.devices.getStatus(deviceId)
}
