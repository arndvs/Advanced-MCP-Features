import fs from 'node:fs/promises'
import path from 'node:path'
import { DB } from './index.js'

async function seed() {
	const dbPath = path.join(process.cwd(), 'db.sqlite')
	// delete the db file if it exists
	await fs.unlink(dbPath).catch(() => {})

	const db = DB.getInstance(dbPath)

	// Helper to run raw SQL (DB class does not expose this, so we use createTag etc. for clearing)
	// We'll clear by deleting all entries via getEntries/getTags and deleteEntry/deleteTag

	// Delete all entry_tags by deleting entries and tags (should cascade if foreign keys are set)
	const entries = await db.getEntries()
	for (const entry of entries) {
		await db.deleteEntry(entry.id)
	}
	const tags = await db.getTags()
	for (const tag of tags) {
		await db.deleteTag(tag.id)
	}

	// Create tags
	const tagsData = [
		{ name: 'work', description: 'Work-related entries' },
		{ name: 'personal', description: 'Personal thoughts and events' },
		{ name: 'travel', description: 'Travel experiences' },
		{ name: 'health', description: 'Health and wellness' },
		{ name: 'family', description: 'Family moments' },
		{ name: 'learning', description: 'Learning and education' },
		{ name: 'nature', description: 'Nature and outdoors' },
		{ name: 'food', description: 'Food and cooking' },
	]
	const createdTags: Array<{ id: number; name: string }> = []
	for (const tag of tagsData) {
		const created = await db.createTag(tag)
		createdTags.push({ id: created.id, name: created.name })
	}

	// Helper to get tag ids by name
	const tagId = (name: string) => createdTags.find((t) => t.name === name)?.id

	// Create entries
	const entriesData = [
		{
			title: 'First day at new job',
			content:
				'Started my new job today. Met the team and set up my workspace.',
			mood: 'excited',
			location: 'office',
			weather: 'sunny',
			isPrivate: 0,
			isFavorite: 1,
			tags: ['work', 'learning'],
		},
		{
			title: 'Family picnic',
			content:
				'Had a wonderful picnic with the family at the park. Kids played frisbee.',
			mood: 'happy',
			location: 'park',
			weather: 'cloudy',
			isPrivate: 0,
			isFavorite: 0,
			tags: ['family', 'nature', 'food'],
		},
		{
			title: 'Trip to Kyoto',
			content:
				'Explored temples and enjoyed local cuisine. The cherry blossoms were beautiful.',
			mood: 'amazed',
			location: 'Kyoto',
			weather: 'rainy',
			isPrivate: 0,
			isFavorite: 1,
			tags: ['travel', 'food', 'nature'],
		},
		{
			title: 'Morning run',
			content: 'Went for a 5k run. Felt energized and healthy.',
			mood: 'energized',
			location: 'neighborhood',
			weather: 'sunny',
			isPrivate: 1,
			isFavorite: 0,
			tags: ['health', 'personal'],
		},
		{
			title: 'Online course completed',
			content:
				'Finished a JavaScript course online. Built a small project as a final assignment.',
			mood: 'accomplished',
			location: 'home',
			weather: 'sunny',
			isPrivate: 0,
			isFavorite: 1,
			tags: ['learning', 'personal', 'work'],
		},
	]

	for (const entry of entriesData) {
		const { tags, ...entryData } = entry
		const createdEntry = await db.createEntry(entryData)
		for (const tagName of tags) {
			const id = tagId(tagName)
			if (id) {
				await db.addTagToEntry({ entryId: createdEntry.id, tagId: id })
			}
		}
	}

	console.log('Seed complete!')
}

seed().catch((e) => {
	console.error(e)
	process.exit(1)
})
