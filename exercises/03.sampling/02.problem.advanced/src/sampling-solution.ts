/**
 * Advanced Sampling Solution - Tag Suggestion System
 * 
 * This demonstrates advanced prompt engineering and response processing for MCP sampling.
 * The key insight here is that getting consistent JSON responses from LLMs requires careful
 * prompt design and proper validation. This solution shows how to:
 * 
 * 1. Design a system prompt that clearly defines the LLM's purpose and expected output format
 * 2. Use structured JSON input with application/json MIME type instead of plain text
 * 3. Parse and validate responses with Zod schemas before processing
 * 4. Handle edge cases like duplicate tags gracefully
 * 5. Provide comprehensive error handling and logging for debugging
 * 
 * The overall flow: system prompt sets expectations -> structured JSON provides context ->
 * LLM responds with formatted suggestions -> response parsed -> tags created/applied
 */

import { invariant } from '@epic-web/invariant'
import { z } from 'zod'
import { type EpicMeMCP } from './index.ts'

const resultSchema = z.object({
	content: z.object({
		type: z.literal('text'),
		text: z.string(),
	}),
})

export async function suggestTagsSampling(agent: EpicMeMCP, entryId: number) {
	const clientCapabilities = agent.server.server.getClientCapabilities()
	if (!clientCapabilities?.sampling) {
		console.error('Client does not support sampling, skipping sampling request')
		return
	}

	const entry = await agent.db.getEntry(entryId)
	invariant(entry, `Entry with ID "${entryId}" not found`)

	const existingTags = await agent.db.getTags()
	const currentTags = await agent.db.getEntryTags(entry.id)

	const result = await agent.server.server.createMessage({
		// The system prompt is crucial for getting consistent JSON responses
		// Key elements: clear purpose, constraints, format requirements, and examples
		// Examples are especially important - LLMs perform much better when they can
		// see exactly what output format you expect
		systemPrompt: `
You are a helpful assistant that suggests relevant tags for journal entries to make them easier to categorize and find later.
You will be provided with a journal entry, it's current tags, and all existing tags.
Only suggest tags that are not already applied to this entry.
Journal entries should not have more than 4-5 tags and it's perfectly fine to not have any tags at all.
Feel free to suggest new tags that are not currently in the database and they will be created.

You will respond with JSON only.
Example responses:
If you have no suggestions, respond with an empty array:
[]

If you have some suggestions, respond with an array of tag objects. Existing tags have an "id" property, new tags have a "name" and "description" property:
[{"id": 1}, {"name": "New Tag", "description": "The description of the new tag"}, {"id": 24}]
		`.trim(),
		messages: [
			{
				role: 'user',
				content: {
					type: 'text',
					// Changed from text/plain to application/json - this helps the LLM
					// understand that it should interpret the input as structured data
					mimeType: 'application/json',
					// Instead of a human-readable message, we send structured JSON data
					// This gives the LLM all the context it needs in a consistent format
					text: JSON.stringify({ entry, currentTags, existingTags }),
				},
			},
		],
		// 100 tokens should be enough for tag suggestions
		// Need to balance between enough tokens for responses and not wasting them
		maxTokens: 100,
	})

	// Validate the LLM response format first
	const parsedResult = resultSchema.parse(result)

	// This handles parsing the LLM response, validating suggestions,
	// creating new tags, and resolving any duplicates
	const { idsToAdd } = await parseAndProcessTagSuggestions({
		agent,
		modelResponse: parsedResult.content.text,
		existingTags,
		currentTags,
	}).catch((error) => {
		// If parsing fails, log the error and send details back to client
		// The raw LLM response helps with debugging parsing issues
		console.error('Error parsing tag suggestions', error)
		void agent.server.server.sendLoggingMessage({
			level: 'error',
			data: {
				message: 'Error parsing tag suggestions',
				modelResponse: parsedResult.content.text,
				error,
			},
		})
		throw error
	})

	// Apply the suggested tags to the entry
	for (const tagId of idsToAdd) {
		await agent.db.addTagToEntry({
			entryId: entry.id,
			tagId,
		})
	}

	// Get updated data and prepare success report
	const allTags = await agent.db.listTags()
	const updatedEntry = await agent.db.getEntry(entry.id)

	// Convert tag IDs back to full tag objects for logging
	const addedTags = Array.from(idsToAdd)
		.map((id) => allTags.find((t) => t.id === id))
		.filter(Boolean)

	// Log the successful tag application for debugging/transparency
	void agent.server.server.sendLoggingMessage({
		level: 'info',
		logger: 'tag-generator', // Custom identifier for filtering logs
		data: {
			message: 'Added tags to entry',
			addedTags,      // List of tag objects that were added
			entry: updatedEntry,  // Updated entry with new tags
		},
	})
}

// Define Zod schemas for validating LLM responses
// This ensures we catch malformed responses before they cause issues
const existingTagSchema = z.object({ id: z.number() })
const newTagSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
})

// Generate TypeScript types from the schemas
type ExistingSuggestedTag = z.infer<typeof existingTagSchema>
type NewSuggestedTag = z.infer<typeof newTagSchema>
type SuggestedTag = ExistingSuggestedTag | NewSuggestedTag

// Helper functions to categorize LLM suggestions
function isExistingTagSuggestion(
	tag: SuggestedTag,
	existingTags: Array<{ id: number; name: string }>,
	currentTags: Array<{ id: number; name: string }>,
): tag is ExistingSuggestedTag {
	// Must have an id, reference an existing tag, and not be already applied
	return (
		'id' in tag &&
		existingTags.some((t) => t.id === tag.id) &&
		!currentTags.some((t) => t.id === tag.id)
	)
}

function isNewTagSuggestion(
	tag: SuggestedTag,
	existingTags: Array<{ id: number; name: string }>,
): tag is NewSuggestedTag {
	// Must have a name and reference a non-existent tag
	return 'name' in tag && existingTags.every((t) => t.name !== tag.name)
}

// Main function that processes the LLM response and handles tag creation/application
async function parseAndProcessTagSuggestions({
	agent,
	modelResponse,
	existingTags,
	currentTags,
}: {
	agent: EpicMeMCP
	modelResponse: string
	existingTags: Array<{ id: number; name: string }>
	currentTags: Array<{ id: number; name: string }>
}) {
	// Parse and validate the LLM's JSON response
	const responseSchema = z.array(z.union([existingTagSchema, newTagSchema]))

	const suggestedTags = responseSchema.parse(JSON.parse(modelResponse))

	// Handle edge case where LLM suggests a tag name that already exists
	// Convert name-based suggestions to ID-based suggestions to avoid duplicates
	const resolvedTags: Array<SuggestedTag> = []
	for (const tag of suggestedTags) {
		if ('name' in tag) {
			const existingTag = existingTags.find((t) => t.name === tag.name)
			if (existingTag) {
				// Use existing tag ID instead of creating a duplicate
				resolvedTags.push({ id: existingTag.id })
				continue
			}
		}
		resolvedTags.push(tag)
	}

	// Separate suggestions into existing vs new tags for different processing
	const suggestedNewTags = resolvedTags.filter((tag) =>
		isNewTagSuggestion(tag, existingTags),
	)
	const suggestedExistingTags = resolvedTags.filter((tag) =>
		isExistingTagSuggestion(tag, existingTags, currentTags),
	)

	// Start with existing tag IDs that need to be applied
	const idsToAdd = new Set<number>(suggestedExistingTags.map((t) => t.id))

	// Create any suggested new tags and add their IDs
	if (suggestedNewTags.length > 0) {
		for (const tag of suggestedNewTags) {
			const newTag = await agent.db.createTag(tag)
			idsToAdd.add(newTag.id)
		}
	}

	// Return the tag IDs to apply along with metadata for logging
	return { idsToAdd, suggestedNewTags, suggestedExistingTags }
}
