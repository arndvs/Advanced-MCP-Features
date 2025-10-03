import { invariant } from '@epic-web/invariant'
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { type EpicMeMCP } from './index.ts'
import {
	getVideoBase64,
	listVideos,
	subscribe as subscribeToVideoChanges,
} from './video.ts'

/**
 * DEVELOPER NOTES: Resource List Change Implementation
 * 
 * This solution demonstrates the complete implementation of resource list change
 * notifications in the MCP protocol. The implementation follows a subscription-based
 * pattern where we listen to data changes and notify clients accordingly.
 * 
 * Implementation Flow:
 * 1. Subscribe to Database Changes: When database records change (tags, entries),
 *    we immediately notify clients via `agent.server.sendResourceListChanged()`
 * 
 * 2. Subscribe to External Sources: For video resources, we subscribe to file system
 *    changes using `subscribeToVideoChanges()` to detect when videos are added/removed
 * 
 * 3. Resource Template Management: The `updateResources()` function handles enabling/
 *    disabling resource templates based on data availability, ensuring only relevant
 *    resources are exposed to clients
 * 
 * 4. Real-time Synchronization: Clients receive immediate notifications when:
 *    - New tags are created (resource instances change)
 *    - Tags are deleted (resource instances change)
 *    - Videos are added/removed (resource instances change)
 *    - Database is cleared (resource categories become unavailable)
 * 
 * Key Technical Details:
 * - Only resource templates with `list` callbacks need change notifications
 * - The `tagsResource` and `videoResource` implement list callbacks, so they need notifications
 * - The `entryResource` doesn't implement list callbacks, so it doesn't need notifications
 * - Resource enabling/disabling is handled separately from list change notifications
 */

export async function initializeResources(agent: EpicMeMCP) {
	// Subscribe to database changes and notify clients when resource lists change
	agent.db.subscribe(() => agent.server.sendResourceListChanged())
	
	// Subscribe to video file changes and notify clients when video resources change
	subscribeToVideoChanges(() => agent.server.sendResourceListChanged())

	const tagListResource = agent.server.registerResource(
		'tags',
		'epicme://tags',
		{
			title: 'Tags',
			description: 'All tags currently in the database',
		},
		async (uri) => {
			const tags = await agent.db.getTags()
			return {
				contents: [
					{
						mimeType: 'application/json',
						text: JSON.stringify(tags),
						uri: uri.toString(),
					},
				],
			}
		},
	)

	// Resource template for individual tags - implements list callback for change notifications
	const tagsResource = agent.server.registerResource(
		'tag',
		new ResourceTemplate('epicme://tags/{id}', {
			complete: {
				async id(value) {
					const tags = await agent.db.getTags()
					return tags
						.map((tag) => tag.id.toString())
						.filter((id) => id.includes(value))
				},
			},
			// This list callback makes this resource template eligible for change notifications
			// When tags are added/removed, clients will be notified to refresh their lists
			list: async () => {
				const tags = await agent.db.getTags()
				return {
					resources: tags.map((tag) => ({
						name: tag.name,
						uri: `epicme://tags/${tag.id}`,
						mimeType: 'application/json',
					})),
				}
			},
		}),
		{
			title: 'Tag',
			description: 'A single tag with the given ID',
		},
		async (uri, { id }) => {
			const tag = await agent.db.getTag(Number(id))
			invariant(tag, `Tag with ID "${id}" not found`)
			return {
				contents: [
					{
						mimeType: 'application/json',
						text: JSON.stringify(tag),
						uri: uri.toString(),
					},
				],
			}
		},
	)

	// Resource template for individual entries - NO list callback, so no change notifications needed
	const entryResource = agent.server.registerResource(
		'entry',
		new ResourceTemplate('epicme://entries/{id}', {
			list: undefined, // No list callback means no change notifications required
			complete: {
				async id(value) {
					const entries = await agent.db.getEntries()
					return entries
						.map((entry) => entry.id.toString())
						.filter((id) => id.includes(value))
				},
			},
		}),
		{
			title: 'Journal Entry',
			description: 'A single journal entry with the given ID',
		},
		async (uri, { id }) => {
			const entry = await agent.db.getEntry(Number(id))
			invariant(entry, `Entry with ID "${id}" not found`)
			return {
				contents: [
					{
						mimeType: 'application/json',
						text: JSON.stringify(entry),
						uri: uri.toString(),
					},
				],
			}
		},
	)

	// Resource template for videos - implements list callback for change notifications
	const videoResource = agent.server.registerResource(
		'video',
		new ResourceTemplate('epicme://videos/{videoId}', {
			complete: {
				async videoId(value) {
					const videos = await listVideos()
					return videos.filter((video) => video.includes(value))
				},
			},
			// This list callback makes this resource template eligible for change notifications
			// When videos are added/removed from the file system, clients will be notified
			list: async () => {
				const videos = await listVideos()
				return {
					resources: videos.map((video) => ({
						name: video,
						uri: `epicme://videos/${video}`,
						mimeType: 'application/json',
					})),
				}
			},
		}),
		{
			title: 'EpicMe Videos',
			description: 'A single video with the given ID',
		},
		async (uri, { videoId }) => {
			invariant(typeof videoId === 'string', 'Video ID is required')

			const videoBase64 = await getVideoBase64(videoId)
			invariant(videoBase64, `Video with ID "${videoId}" not found`)
			return {
				contents: [
					{
						mimeType: 'video/mp4',
						text: videoBase64,
						uri: uri.toString(),
					},
				],
			}
		},
	)

	/**
	 * Resource Template Management Function
	 * 
	 * This function handles enabling/disabling resource templates based on data availability.
	 * It's separate from the list change notifications but works in conjunction with them.
	 * 
	 * Key Concepts:
	 * - Resource templates can be enabled/disabled dynamically
	 * - When no data exists, templates are disabled to avoid exposing empty resources
	 * - When data becomes available, templates are enabled to expose the resources
	 * - This is different from list change notifications which inform about instance changes
	 */
	async function updateResources() {
		const entries = await agent.db.getEntries()
		const tags = await agent.db.getTags()
		const videos = await listVideos()

		// Enable/disable tag resources based on availability
		if (tags.length > 0) {
			if (!tagListResource.enabled) tagListResource.enable()
			if (!tagsResource.enabled) tagsResource.enable()
		} else {
			if (tagListResource.enabled) tagListResource.disable()
			if (tagsResource.enabled) tagsResource.disable()
		}

		// Enable/disable entry resources based on availability
		if (entries.length > 0) {
			if (!entryResource.enabled) entryResource.enable()
		} else {
			if (entryResource.enabled) entryResource.disable()
		}

		// Enable/disable video resources based on availability
		if (videos.length > 0) {
			if (!videoResource.enabled) videoResource.enable()
		} else {
			if (videoResource.enabled) videoResource.disable()
		}
	}

	// Subscribe to database changes for resource template management
	// This handles enabling/disabling templates when data becomes available/unavailable
	agent.db.subscribe(updateResources)
	
	// Initialize resource states on startup
	await updateResources()
}
