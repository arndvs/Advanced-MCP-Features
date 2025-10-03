import { invariant } from '@epic-web/invariant'
import { type CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import {
	createEntryInputSchema,
	createTagInputSchema,
	entryIdSchema,
	entrySchema,
	entryTagIdSchema,
	entryTagSchema,
	entryWithTagsSchema,
	tagIdSchema,
	tagSchema,
	updateEntryInputSchema,
	updateTagInputSchema,
} from './db/schema.ts'
import { type EpicMeMCP } from './index.ts'
import { createWrappedVideo } from './video.ts'

export async function initializeTools(agent: EpicMeMCP) {
	/**
	 * STRUCTURED OUTPUT IMPLEMENTATION
	 * 
	 * This exercise demonstrates how to implement structured output for MCP tools.
	 * Instead of returning arbitrary text, each tool returns:
	 * 1. An outputSchema defining the exact structure of returned data
	 * 2. structuredContent with machine-readable data matching that schema
	 * 3. Human-readable content for LLM interpretation
	 * 4. Resource links for accessing created/updated entities
	 * 
	 * Benefits:
	 * - Type safety and validation
	 * - Machine-readable responses for UI automation
	 * - Predictable data structure for integration
	 * - Better error handling and validation
	 */

	agent.server.registerTool(
		'create_entry',
		{
			title: 'Create Entry',
			description: 'Create a new journal entry',
			annotations: {
				destructiveHint: false,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			// Define the exact structure of what this tool returns
			// This schema ensures clients know exactly what to expect
			outputSchema: { entry: entryWithTagsSchema },
		},
		async (entry) => {
			const createdEntry = await agent.db.createEntry(entry as {
				title: string
				content: string
				mood?: string
				location?: string
				weather?: string
				isPrivate?: number
				isFavorite?: number
			})
			if (entry.tags) {
				for (const tagId of entry.tags) {
					await agent.db.addTagToEntry({
						entryId: createdEntry.id,
						tagId,
					})
				}
			}

			// Refetch entry to get updated tags
			const entryWithTags = await agent.db.getEntry(createdEntry.id)
			invariant(entryWithTags, `Failed to refetch created entry`)
			
			// STRUCTURED CONTENT: Machine-readable data matching our outputSchema
			// This must exactly match the structure defined in outputSchema above
			// The { entry: entryWithTags } matches the { entry: entryWithTagsSchema } output schema
			const structuredContent = { entry: entryWithTags }
			
			return {
				structuredContent, // Machine-validated, typed data for automation/UIs
				content: [
					// Human-readable success message for LLM interpretation
					createText(
						`Entry "${entryWithTags.title}" created successfully with ID "${entryWithTags.id}"`,
					),
					// Resource link: Allows clients to access this specific entry
					// Better than embedding full data - creates discoverable references
					createEntryResourceLink(entryWithTags),
					// BACKWARD COMPATIBILITY: JSON representation of structured content
					// Some clients may not yet support structuredContent, so we include both
					// TODO: Remove this duplication once all clients support structuredContent
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'get_entry',
		{
			title: 'Get Entry',
			description: 'Get a journal entry by ID',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: entryIdSchema,
			// Read-only tools still benefit from structured output
			outputSchema: { entry: entryWithTagsSchema },
		},
		async ({ id }) => {
			const entry = await agent.db.getEntry(id)
			invariant(entry, `Entry with ID "${id}" not found`)
			
			// MREAD operations don't always need human-readable success messages
			// The LLM knows if it got data back, the operation was successful
			const structuredContent = { entry }
			return {
				structuredContent,
				content: [
					createEntryResourceLink(entry),
					// Backward compatibility JSON for clients
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'list_entries',
		{
			title: 'List Entries',
			description: 'List all journal entries',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			outputSchema: { entries: z.array(entrySchema) },
		},
		async () => {
			const entries = await agent.db.getEntries()
			const entryLinks = entries.map(createEntryResourceLink)
			const structuredContent = { entries }
			return {
				structuredContent,
				content: [
					createText(`Found ${entries.length} entries.`),
					...entryLinks,
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'update_entry',
		{
			title: 'Update Entry',
			description:
				'Update a journal entry. Fields that are not provided (or set to undefined) will not be updated. Fields that are set to null or any other value will be updated.',
			annotations: {
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: updateEntryInputSchema,
			outputSchema: { entry: entryWithTagsSchema },
		},
		async ({ id, ...updates }) => {
			const existingEntry = await agent.db.getEntry(id)
			invariant(existingEntry, `Entry with ID "${id}" not found`)
			const updatedEntry = await agent.db.updateEntry(id, updates)
			const structuredContent = { entry: updatedEntry }
			return {
				structuredContent,
				content: [
					createText(
						`Entry "${updatedEntry.title}" (ID: ${id}) updated successfully`,
					),
					createEntryResourceLink(updatedEntry),
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'delete_entry',
		{
			title: 'Delete Entry',
			description: 'Delete a journal entry',
			annotations: {
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: entryIdSchema,
			// DELETION PATTERN: Include explicit success flag + deleted entity
			// This pattern is important because we return the old entry, but that
			// doesn't confirm deletion was successful - we need the explicit success flag
			outputSchema: { success: z.boolean(), entry: entryWithTagsSchema },
		},
		async ({ id }) => {
			const existingEntry = await agent.db.getEntry(id)
			invariant(existingEntry, `Entry with ID "${id}" not found`)
			await agent.db.deleteEntry(id)

			// Note: We return the entry BEFORE deletion for reference
			// The success boolean explicitly confirms the operation completed
			const structuredContent = { success: true, entry: existingEntry }
			return {
				structuredContent,
				content: [
					createText(
						`Entry "${existingEntry.title}" (ID: ${id}) deleted successfully`,
					),
					createEntryResourceLink(existingEntry),
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'create_tag',
		{
			title: 'Create Tag',
			description: 'Create a new tag',
			annotations: {
				destructiveHint: false,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: createTagInputSchema,
			outputSchema: { tag: tagSchema },
		},
		async (tag) => {
			const createdTag = await agent.db.createTag(tag)
			const structuredContent = { tag: createdTag }
			return {
				structuredContent,
				content: [
					createText(
						`Tag "${createdTag.name}" created successfully with ID "${createdTag.id}"`,
					),
					createTagResourceLink(createdTag),
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'get_tag',
		{
			title: 'Get Tag',
			description: 'Get a tag by ID',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: tagIdSchema,
			outputSchema: { tag: tagSchema },
		},
		async ({ id }) => {
			const tag = await agent.db.getTag(id)
			invariant(tag, `Tag ID "${id}" not found`)
			const structuredContent = { tag }
			return {
				structuredContent,
				content: [createTagResourceLink(tag), createText(structuredContent)],
			}
		},
	)

	agent.server.registerTool(
		'list_tags',
		{
			title: 'List Tags',
			description: 'List all tags',
			annotations: {
				readOnlyHint: true,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			outputSchema: { tags: z.array(tagSchema) },
		},
		async () => {
			const tags = await agent.db.getTags()
			const tagLinks = tags.map(createTagResourceLink)
			const structuredContent = { tags }
			return {
				structuredContent,
				content: [
					createText(`Found ${tags.length} tags.`),
					...tagLinks,
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'update_tag',
		{
			title: 'Update Tag',
			description: 'Update a tag',
			annotations: {
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: updateTagInputSchema,
			outputSchema: { tag: tagSchema },
		},
		async ({ id, ...updates }) => {
			const updatedTag = await agent.db.updateTag(id, updates)
			const structuredContent = { tag: updatedTag }
			return {
				structuredContent,
				content: [
					createText(
						`Tag "${updatedTag.name}" (ID: ${id}) updated successfully`,
					),
					createTagResourceLink(updatedTag),
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'delete_tag',
		{
			title: 'Delete Tag',
			description: 'Delete a tag',
			annotations: {
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: tagIdSchema,
			outputSchema: { success: z.boolean(), tag: tagSchema },
		},
		async ({ id }) => {
			const existingTag = await agent.db.getTag(id)
			invariant(existingTag, `Tag ID "${id}" not found`)

			await agent.db.deleteTag(id)
			const structuredContent = { success: true, tag: existingTag }
			return {
				structuredContent,
				content: [
					createText(
						`Tag "${existingTag.name}" (ID: ${id}) deleted successfully`,
					),
					createTagResourceLink(existingTag),
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'add_tag_to_entry',
		{
			title: 'Add Tag to Entry',
			description: 'Add a tag to an entry',
			annotations: {
				destructiveHint: false,
				idempotentHint: true,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: entryTagIdSchema,
			outputSchema: { success: z.boolean(), entryTag: entryTagSchema },
		},
		async ({ entryId, tagId }) => {
			const tag = await agent.db.getTag(tagId)
			const entry = await agent.db.getEntry(entryId)
			invariant(tag, `Tag ${tagId} not found`)
			invariant(entry, `Entry with ID "${entryId}" not found`)
			const entryTag = await agent.db.addTagToEntry({
				entryId,
				tagId,
			})
			const structuredContent = { success: true, entryTag }
			return {
				structuredContent,
				content: [
					createText(
						`Tag "${tag.name}" (ID: ${entryTag.tagId}) added to entry "${entry.title}" (ID: ${entryTag.entryId}) successfully`,
					),
					createTagResourceLink(tag),
					createEntryResourceLink(entry),
					createText(structuredContent),
				],
			}
		},
	)

	agent.server.registerTool(
		'create_wrapped_video',
		{
			title: 'Create Wrapped Video',
			description:
				'Create a "wrapped" video highlighting stats of your journaling this year',
			annotations: {
				destructiveHint: false,
				openWorldHint: false,
			} satisfies ToolAnnotations,
			inputSchema: {
				year: z
					.number()
					.default(new Date().getFullYear())
					.describe(
						'The year to create a wrapped video for (defaults to current year)',
					),
				mockTime: z
					.number()
					.optional()
					.describe(
						'If set to > 0, use mock mode and this is the mock wait time in milliseconds',
					),
			},
			outputSchema: { videoUri: z.string().describe('The URI of the video') },
		},
		async ({ year = new Date().getFullYear(), mockTime }) => {
			const entries = await agent.db.getEntries()
			const filteredEntries = entries.filter(
				(entry) => new Date(entry.createdAt * 1000).getFullYear() === year,
			)
			const tags = await agent.db.getTags()
			const filteredTags = tags.filter(
				(tag) => new Date(tag.createdAt * 1000).getFullYear() === year,
			)
			const videoUri = await createWrappedVideo({
				entries: filteredEntries,
				tags: filteredTags,
				year,
				mockTime,
			})
			
			// VIDEO PATTERN: Simple structured content with URI
			// For file/resource creation, we primarily need the URI
			const structuredContent = { videoUri }
			return {
				structuredContent,
				content: [
					createText('Video created successfully'),
					// SPECIAL CASE: Keep resource_link even though videoUri is in structuredContent
					// Some clients may not extract URIs from structured content yet
					// This ensures backward compatibility for file/media resources
					{
						type: 'resource_link',
						uri: videoUri,
						name: `wrapped-${year}.mp4`,
						description: `Wrapped Video for ${year}`,
						mimeType: 'video/mp4',
					},
					// Backward compatibility JSON (less important here since we have resource_link)
					createText(structuredContent),
				],
			}
		},
	)
}

type ToolAnnotations = {
	// defaults to true, so only allow false
	openWorldHint?: false
} & (
	| {
			// when readOnlyHint is true, none of the other annotations can be changed
			readOnlyHint: true
	  }
	| {
			destructiveHint?: false // Only allow false (default is true)
			idempotentHint?: true // Only allow true (default is false)
	  }
)

/**
 * BACKWARD COMPATIBILITY UTILITY
 * 
 * This function handles converting structured content to JSON text for clients
 * that may not yet support the structuredContent field.
 * 
 * Usage patterns:
 * - For success messages: createText("Operation completed successfully")
 * - For structured data: createText(structuredContent) - converts to JSON
 */
function createText(text: unknown): CallToolResult['content'][number] {
	if (typeof text === 'string') {
		return { type: 'text', text }
	} else {
		return { type: 'text', text: JSON.stringify(text) }
	}
}

type ResourceLinkContent = Extract<
	CallToolResult['content'][number],
	{ type: 'resource_link' }
>

// RESOURCE LINKS: Create discoverable references to entities
// Instead of embedding full data, we provide links that clients can follow
// This enables subscription patterns and reduces response size
function createEntryResourceLink(entry: {
	id: number
	title: string
}): ResourceLinkContent {
	return {
		type: 'resource_link',
		uri: `epicme://entries/${entry.id}`,
		name: entry.title,
		description: `Journal Entry: "${entry.title}"`,
		mimeType: 'application/json',
	}
}

function createTagResourceLink(tag: {
	id: number
	name: string
}): ResourceLinkContent {
	return {
		type: 'resource_link',
		uri: `epicme://tags/${tag.id}`,
		name: tag.name,
		description: `Tag: "${tag.name}"`,
		mimeType: 'application/json',
	}
}
