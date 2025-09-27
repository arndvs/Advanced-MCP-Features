import {
	SubscribeRequestSchema,
	UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { type EpicMeMCP } from './index.ts'
import { listVideos, subscribe as subscribeToVideoChanges } from './video.ts'

const uriSubscriptions = new Set<string>()

export async function initializeSubscriptions(agent: EpicMeMCP) {
	agent.server.server.setRequestHandler(
		SubscribeRequestSchema,
		async ({ params }) => {
			uriSubscriptions.add(params.uri)
			return {}
		},
	)

	agent.server.server.setRequestHandler(
		UnsubscribeRequestSchema,
		async ({ params }) => {
			uriSubscriptions.delete(params.uri)
			return {}
		},
	)

	agent.db.subscribe(async (changes) => {
		for (const entryId of changes.entries ?? []) {
			const uri = `epicme://entries/${entryId}`
			if (uriSubscriptions.has(uri)) {
				await agent.server.server.notification({
					method: 'notifications/resources/updated',
					params: { uri, title: `Entry ${entryId}` },
				})
			}
		}

		for (const tagId of changes.tags ?? []) {
			const uri = `epicme://tags/${tagId}`
			if (uriSubscriptions.has(uri)) {
				await agent.server.server.notification({
					method: 'notifications/resources/updated',
					params: { uri, title: `Tag ${tagId}` },
				})
			}
		}
	})

	subscribeToVideoChanges(async () => {
		const videos = await listVideos()
		for (const video of videos) {
			const uri = `epicme://videos/${video}`
			if (uriSubscriptions.has(uri)) {
				await agent.server.server.notification({
					method: 'notifications/resources/updated',
					params: { uri, title: `Video ${video}` },
				})
			}
		}
	})
}
