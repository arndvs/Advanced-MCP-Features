#!/usr/bin/env node

import { createServer } from 'http'
import { randomBytes } from 'node:crypto'
import { styleText } from 'node:util'
import { execa } from 'execa'
import getPort from 'get-port'
import httpProxy from 'http-proxy'

const { createProxyServer } = httpProxy

const [, , ...args] = process.argv
const [transport] = args

const serverPort = await getPort({
	port: Array.from({ length: 1000 }, (_, i) => i + 10000),
	exclude: [process.env.PORT].filter(Boolean).map(Number),
})
const clientPort = await getPort({
	port: Array.from({ length: 1000 }, (_, i) => i + 9000),
	exclude: [process.env.PORT, serverPort].filter(Boolean).map(Number),
})

const sessionToken = randomBytes(32).toString('hex')
// Spawn mcp-inspector as a sidecar process
const inspectorProcess = execa('mcp-inspector', [], {
	env: {
		...process.env,
		SERVER_PORT: serverPort,
		CLIENT_PORT: clientPort,
		MCP_PROXY_AUTH_TOKEN: sessionToken,
		MCP_AUTO_OPEN_ENABLED: 'false',
		ALLOWED_ORIGINS: [
			`http://localhost:${clientPort}`,
			`http://127.0.0.1:${clientPort}`,
			`http://localhost:${process.env.PORT}`,
			`http://127.0.0.1:${process.env.PORT}`,
		].join(','),
	},
	stdio: ['inherit', 'pipe', 'inherit'], // capture stdout
})

/*
Starting MCP inspector...

⚙️ Proxy server listening on localhost:10039

🔑 Session token: 27d8e2e73dfdc8051ba0c1cc38e07a0623680184167543ccfd33c61f2d3819b3
   Use this token to authenticate requests or set DANGEROUSLY_OMIT_AUTH=true to disable auth


🚀 MCP Inspector is up and running at:
   http://localhost:9038/?MCP_PROXY_PORT=10039&MCP_PROXY_AUTH_TOKEN=27d8e2e73dfdc8051ba0c1cc38e07a0623680184167543ccfd33c61f2d3819b3

*/

// Wait for the inspector to be up before starting the proxy server
function waitForInspectorReady() {
	return new Promise((resolve) => {
		inspectorProcess.stdout.on('data', (data) => {
			const str = data.toString()
			if (str.includes(clientPort)) resolve()

			// Suppress specific logs from inspector
			if (
				/server listening/i.test(str) ||
				/inspector is up/i.test(str) ||
				/session token/i.test(str) ||
				/DANGEROUSLY_OMIT_AUTH/i.test(str) ||
				/up and running/i.test(str) ||
				/localhost/i.test(str) ||
				/auto-open is disabled/i.test(str)
			) {
				return
			}
			process.stdout.write(str) // print all other inspector logs
		})
	})
}

await waitForInspectorReady()

const proxy = createProxyServer({
	target: `http://localhost:${clientPort}`,
	ws: true,
	changeOrigin: true,
})

const server = createServer((req, res) => {
	if (req.url === '/' || req.url.startsWith('/?')) {
		const url = new URL(req.url, `http://localhost:${clientPort}`)
		const transport = 'stdio'
		const command = 'npm'
		const args = `--silent --prefix "${process.cwd()}" run dev:mcp`
		url.searchParams.set('transport', transport)
		url.searchParams.set('serverCommand', command)
		url.searchParams.set('serverArgs', args)
		url.searchParams.set('MCP_PROXY_AUTH_TOKEN', sessionToken)
		url.searchParams.set(
			'MCP_PROXY_FULL_ADDRESS',
			`http://localhost:${serverPort}`,
		)
		url.searchParams.set('MCP_REQUEST_MAX_TOTAL_TIMEOUT', 1000 * 60 * 15)
		url.searchParams.set('MCP_SERVER_REQUEST_TIMEOUT', 1000 * 60 * 5)
		const correctedUrl = url.pathname + url.search
		if (correctedUrl !== req.url) {
			res.writeHead(302, { Location: correctedUrl })
			res.end()
			return
		}
	}
	proxy.web(req, res, {}, (err) => {
		res.writeHead(502, { 'Content-Type': 'text/plain' })
		res.end('Proxy error: ' + err.message)
	})
})

server.on('upgrade', (req, socket, head) => {
	proxy.ws(req, socket, head)
})

server.listen(process.env.PORT, () => {
	// Enhanced, colorized logs
	const proxyUrl = `http://localhost:${process.env.PORT}`
	console.log(
		styleText('cyan', `🐨 Proxy server running: `) +
			styleText('green', proxyUrl),
	)
	console.log(
		styleText('gray', `- Client port: `) +
			styleText('magenta', clientPort.toString()),
	)
	console.log(
		styleText('gray', `- Server port: `) +
			styleText('yellow', serverPort.toString()),
	)
})

// Ensure proper cleanup
function cleanup() {
	if (inspectorProcess && !inspectorProcess.killed) {
		inspectorProcess.kill()
	}
	proxy.close()
	server.close(() => {
		console.log('HTTP server closed')
	})
}

process.on('exit', cleanup)
process.on('SIGINT', () => {
	cleanup()
	process.exit(0)
})
process.on('SIGTERM', () => {
	cleanup()
	process.exit(0)
})
