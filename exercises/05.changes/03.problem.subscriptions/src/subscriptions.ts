// 💰 you'll need this:
// import {
// 	SubscribeRequestSchema,
// 	UnsubscribeRequestSchema,
// } from '@modelcontextprotocol/sdk/types.js'
// import { listVideos, subscribe as subscribeToVideoChanges } from './video.ts'
import { type EpicMeMCP } from './index.ts'

// 🐨 create a "uriSubscriptions" Set of strings to track URI subscriptions

export async function initializeSubscriptions(agent: EpicMeMCP) {
	// 🐨 Set up a request handler for SubscribeRequestSchema that adds the given URI to the uriSubscriptions set.
	// 🦉 This should allow clients to subscribe to updates for a specific resource URI.
	//
	// 🐨 Set up a request handler for UnsubscribeRequestSchema that removes the given URI from the uriSubscriptions set.
	// 🦉 This should allow clients to unsubscribe from updates for a specific resource URI.
	//
	// 🐨 Subscribe to database changes using agent.db.subscribe.
	//   - For each changed entry or tag, check if its URI is in uriSubscriptions.
	//   - If so, send a notification to the client that the resource was updated, including the URI and a title.
	//
	// 🐨 Subscribe to video changes using subscribeToVideoChanges.
	//   - For each video, check if its URI is in uriSubscriptions.
	//   - If so, send a notification to the client that the video resource was updated, including the URI and a title.
}
