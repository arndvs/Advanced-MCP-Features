import {
	SubscribeRequestSchema,
	UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { type EpicMeMCP } from './index.ts'
import { listVideos, subscribe as subscribeToVideoChanges } from './video.ts'

/**
 * Developer Notes: Resource Subscription Implementation
 * 
 * This module implements the MCP subscription pattern for real-time resource updates.
 * The subscription system allows clients to subscribe to specific resource URIs and 
 * receive notifications when those resources change, enabling dynamic, up-to-date 
 * conversations with the LLM.
 * 
 * Key Concepts:
 * - URI-based subscriptions: Clients subscribe to specific resource URIs (e.g., "epicme://entries/123")
 * - Change notifications: Server sends notifications when subscribed resources are modified
 * - Memory-based tracking: Subscription state is stored in a Set for simplicity (in production, consider persistence)
 */

// Track which resource URIs clients have subscribed to
// In production, this might need to be persisted or segmented per client
const uriSubscriptions = new Set<string>()

export async function initializeSubscriptions(agent: EpicMeMCP) {
	/**
	 * Subscribe Request Handler
	 * 
	 * Handles incoming subscription requests from clients. When a client wants to 
	 * subscribe to updates for a specific resource, they send a SubscribeRequest 
	 * with the resource URI. We add this URI to our tracking set.
	 * 
	 * The client will then receive notifications whenever this resource changes.
	 */
	agent.server.server.setRequestHandler(
		SubscribeRequestSchema,
		async ({ params }) => {
			uriSubscriptions.add(params.uri)
			return {}
		},
	)

	/**
	 * Unsubscribe Request Handler
	 * 
	 * Handles unsubscribe requests from clients. When a client no longer wants 
	 * to receive updates for a resource, they send an UnsubscribeRequest with 
	 * the resource URI. We remove this URI from our tracking set.
	 * 
	 * After unsubscribing, the client will no longer receive notifications for this resource.
	 */
	agent.server.server.setRequestHandler(
		UnsubscribeRequestSchema,
		async ({ params }) => {
			uriSubscriptions.delete(params.uri)
			return {}
		},
	)

	/**
	 * Database Change Subscription
	 * 
	 * Subscribe to database changes to detect when journal entries or tags are modified.
	 * When changes occur, we check if any clients are subscribed to the affected resources
	 * and send them notifications.
	 * 
	 * This creates a reactive system where clients automatically receive updates
	 * for resources they're interested in, without needing to poll or manually refresh.
	 */
	agent.db.subscribe(async (changes) => {
		// Handle journal entry changes
		for (const entryId of changes.entries ?? []) {
			const uri = `epicme://entries/${entryId}`
			if (uriSubscriptions.has(uri)) {
				// Send notification to subscribed clients that this entry was updated
				await agent.server.server.notification({
					method: 'notifications/resources/updated',
					params: { uri, title: `Entry ${entryId}` },
				})
			}
		}

		// Handle tag changes
		for (const tagId of changes.tags ?? []) {
			const uri = `epicme://tags/${tagId}`
			if (uriSubscriptions.has(uri)) {
				// Send notification to subscribed clients that this tag was updated
				await agent.server.server.notification({
					method: 'notifications/resources/updated',
					params: { uri, title: `Tag ${tagId}` },
				})
			}
		}
	})

	/**
	 * Video Change Subscription
	 * 
	 * Subscribe to video file changes (external to the database). When video files
	 * are added, removed, or modified, we check if any clients are subscribed to
	 * video resources and send them notifications.
	 * 
	 * This handles the case where video resources change outside of the database
	 * (e.g., file system changes), ensuring clients stay updated on video content.
	 */
	subscribeToVideoChanges(async () => {
		const videos = await listVideos()
		for (const video of videos) {
			const uri = `epicme://videos/${video}`
			if (uriSubscriptions.has(uri)) {
				// Send notification to subscribed clients that this video was updated
				await agent.server.server.notification({
					method: 'notifications/resources/updated',
					params: { uri, title: `Video ${video}` },
				})
			}
		}
	})
}
