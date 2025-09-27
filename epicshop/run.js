// This script spawns the `dev:mcp` script of the app ID and defaults to the playground

import { getApps, isPlaygroundApp } from '@epic-web/workshop-utils/apps.server'
import { execa } from 'execa'

async function main() {
	const apps = await getApps()

	const appParts = process.argv[2]
	let selectedApp = null
	if (appParts) {
		let [givenExercise, givenStep, givenType = 'solution'] = appParts.split('.')
		selectedApp = apps.find((app) => {
			return (
				app.exerciseNumber === Number(givenExercise) &&
				app.stepNumber === Number(givenStep) &&
				app.type.includes(givenType)
			)
		})
	} else {
		selectedApp = apps.find(isPlaygroundApp)
	}
	if (!selectedApp) {
		console.error('No app found')
		return
	}

	console.error('Running MCP server for', selectedApp.relativePath)

	await execa('npm', ['--prefix', selectedApp.fullPath, 'run', 'dev:mcp'], {
		cwd: selectedApp.fullPath,
		stdio: 'inherit',
		env: {
			...process.env,
			PORT: selectedApp.dev.portNumber,
		},
	})
}

await main()
