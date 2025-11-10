import { ModuleInstance } from './main.js'

export async function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function refresh(self: ModuleInstance, deviceId: string): Promise<void> {
	await self.smartThingsClient.devices.executeCommand(deviceId, {
		component: 'main',
		capability: 'refresh',
		command: 'refresh',
	})
}
