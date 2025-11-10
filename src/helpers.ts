import { ModuleInstance } from './main.js'

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
