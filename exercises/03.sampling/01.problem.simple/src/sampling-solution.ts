import { type EpicMeMCP } from './index.ts'

export async function suggestTagsSampling(agent: EpicMeMCP, entryId: number) {
	// Check if the client supports sampling capability before attempting to use it
	// Not all MCP clients support sampling (like VS Code experimental features)
	const clientCapabilities = agent.server.server.getClientCapabilities()
	if (!clientCapabilities?.sampling) {
		console.error('Client does not support sampling, skipping sampling request')
		return
	}

	// Create a sampling request - this asks the client to borrow the user's LLM
	// The server sends this request to the client, which then asks the user permission
	// If approved, the client makes the LLM call using the user's tokens/subscription
	const result = await agent.server.server.createMessage({
		// Simple system prompt - this will be enhanced in future exercises
		systemPrompt: `
You are a helpful assistant.

We'll put more in here later...
		`.trim(),
		messages: [
			{
				role: 'user',
				content: {
					type: 'text',
					mimeType: 'text/plain',
					text: `
You just created a new journal entry with the id ${entryId}.

Please respond with a proper commendation for yourself.
					`.trim(),
				},
			},
		],
		// Keep token count low for this simple example
		// In real usage, this could be higher for generating tag suggestions
		maxTokens: 10,
	})

	// Send a logging notification to inform the client about the sampling result
	// This is a "fire and forget" operation - we don't need to wait for it
	// The client can display these logs to show users what happened behind the scenes
	void agent.server.server.sendLoggingMessage({
		level: 'info', // Info level will be displayed in debug/info logging modes
		logger: 'tag-generator', // Namespace the logger for easy filtering
		data: {
			message: 'Received response from model',
			modelResponse: result.content.text,
		},
	})
}
