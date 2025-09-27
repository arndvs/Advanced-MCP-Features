import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import { migrate } from './migrations.ts'
import {
	type Entry,
	type NewEntry,
	type Tag,
	type NewTag,
	type EntryTag,
	type EntryWithTags,
	entrySchema,
	newEntrySchema,
	tagSchema,
	newTagSchema,
	entryTagSchema,
} from './schema.ts'
import { sql, snakeToCamel } from './utils.ts'

export type { Entry, NewEntry, Tag, NewTag, EntryTag }

export class DB {
	#db: DatabaseSync
	#subscribers = new Set<
		(changes: { tags?: number[]; entries?: number[] }) => void
	>()

	subscribe(
		subscriber: (changes: { tags?: number[]; entries?: number[] }) => void,
	) {
		this.#subscribers.add(subscriber)
		return () => {
			this.#subscribers.delete(subscriber)
		}
	}

	#notifySubscribers(changes: { tags?: number[]; entries?: number[] }) {
		for (const subscriber of this.#subscribers) {
			subscriber(changes)
		}
	}

	constructor(db: DatabaseSync) {
		this.#db = db
	}

	static getInstance(path: string) {
		const db = new DB(new DatabaseSync(path))
		migrate(db.#db)
		return db
	}

	// Entry Methods
	async createEntry(entry: z.input<typeof newEntrySchema>) {
		const validatedEntry = newEntrySchema.parse(entry)
		const stmt = this.#db.prepare(sql`
			INSERT INTO entries (
				title, content, mood, location, weather,
				is_private, is_favorite
			) VALUES (
				?, ?, ?, ?, ?, ?, ?
			)
		`)
		const result = stmt.run(
			validatedEntry.title,
			validatedEntry.content,
			validatedEntry.mood ?? null,
			validatedEntry.location ?? null,
			validatedEntry.weather ?? null,
			validatedEntry.isPrivate,
			validatedEntry.isFavorite,
		)
		const id =
			result.lastInsertRowid !== undefined
				? Number(result.lastInsertRowid)
				: undefined
		if (!id) {
			throw new Error('Failed to create entry')
		}
		const createdEntry = await this.getEntry(id)
		if (!createdEntry) {
			throw new Error('Failed to query created entry')
		}
		this.#notifySubscribers({ entries: [id] })
		return createdEntry
	}

	async getEntries() {
		const stmt = this.#db.prepare(
			sql`SELECT * FROM entries ORDER BY created_at DESC`,
		)
		const entries = stmt.all().map((entry) => snakeToCamel(entry))
		return z.array(entrySchema).parse(entries)
	}

	async getEntry(id: number) {
		const stmt = this.#db.prepare(sql`SELECT * FROM entries WHERE id = ?`)
		const entryResult = stmt.get(id)
		if (!entryResult) return null
		const entry = entrySchema.parse(snakeToCamel(entryResult))
		const tagsStmt = this.#db.prepare(sql`
			SELECT t.id, t.name
			FROM tags t
			JOIN entry_tags et ON et.tag_id = t.id
			WHERE et.entry_id = ?
			ORDER BY t.name
		`)
		const tagsResult = tagsStmt.all(id).map((tag) => snakeToCamel(tag))
		const tags = z
			.array(z.object({ id: z.number(), name: z.string() }))
			.parse(tagsResult)
		return { ...entry, tags } as EntryWithTags
	}

	// TODO: listEntries to actually filter by tagIds
	async listEntries(tagIds?: Array<number>) {
		const stmt = this.#db.prepare(
			sql`SELECT * FROM entries ORDER BY created_at DESC`,
		)
		const results = stmt.all().map((result) => snakeToCamel(result))
		return z.array(entrySchema).parse(results)
	}

	async updateEntry(
		id: number,
		entry: Partial<z.input<typeof newEntrySchema>>,
	) {
		const existingEntry = await this.getEntry(id)
		if (!existingEntry) {
			throw new Error(`Entry with ID ${id} not found`)
		}
		const updates = Object.entries(entry)
			.filter(([key, value]) => value !== undefined)
			.map(([key]) => `${key} = ?`)
			.join(', ')
		if (!updates) {
			return existingEntry
		}
		const updateValues = [
			...Object.entries(entry)
				.filter(([, value]) => value !== undefined)
				.map(([, value]) => value),
			id,
		]
		if (updateValues.some((v) => v === undefined)) {
			throw new Error('Undefined value in updateEntry parameters')
		}
		const stmt = this.#db.prepare(sql`
			UPDATE entries 
			SET ${updates}, updated_at = CURRENT_TIMESTAMP 
			WHERE id = ?
		`)
		const result = stmt.run(...updateValues)
		if (!result.changes) {
			throw new Error('Failed to update entry')
		}
		const updatedEntry = await this.getEntry(id)
		if (!updatedEntry) {
			throw new Error('Failed to query updated entry')
		}
		this.#notifySubscribers({ entries: [id] })
		return updatedEntry
	}

	async deleteEntry(id: number) {
		const existingEntry = await this.getEntry(id)
		if (!existingEntry) {
			throw new Error(`Entry with ID ${id} not found`)
		}
		const stmt = this.#db.prepare(sql`DELETE FROM entries WHERE id = ?`)
		const result = stmt.run(id)
		if (!result.changes) {
			throw new Error('Failed to delete entry')
		}
		this.#notifySubscribers({ entries: [id] })
		return true
	}

	// Tag Methods
	async createTag(tag: NewTag) {
		const validatedTag = newTagSchema.parse(tag)
		const stmt = this.#db.prepare(sql`
			INSERT INTO tags (name, description)
			VALUES (?, ?)
		`)
		const result = stmt.run(validatedTag.name, validatedTag.description ?? null)
		const id =
			result.lastInsertRowid !== undefined
				? Number(result.lastInsertRowid)
				: undefined
		if (!id) {
			throw new Error('Failed to create tag')
		}
		const createdTag = await this.getTag(id)
		if (!createdTag) {
			throw new Error('Failed to query created tag')
		}
		this.#notifySubscribers({ tags: [id] })
		return createdTag
	}

	async getTags() {
		const stmt = this.#db.prepare(sql`SELECT * FROM tags ORDER BY name`)
		const results = stmt.all().map((result) => snakeToCamel(result))
		return z.array(tagSchema).parse(results)
	}

	async getTag(id: number) {
		const stmt = this.#db.prepare(sql`SELECT * FROM tags WHERE id = ?`)
		const result = stmt.get(id)
		if (!result) return null
		return tagSchema.parse(snakeToCamel(result))
	}

	async listTags() {
		const stmt = this.#db.prepare(sql`SELECT id, name FROM tags ORDER BY name`)
		const results = stmt.all().map((result) => snakeToCamel(result))
		return z
			.array(z.object({ id: z.number(), name: z.string() }))
			.parse(results)
	}

	async updateTag(id: number, tag: Partial<z.input<typeof newTagSchema>>) {
		const existingTag = await this.getTag(id)
		if (!existingTag) {
			throw new Error(`Tag with ID ${id} not found`)
		}
		const updates = Object.entries(tag)
			.filter(([, value]) => value !== undefined)
			.map(([key]) => `${key} = ?`)
			.join(', ')
		if (!updates) {
			return existingTag
		}
		const updateValues = [
			...Object.entries(tag)
				.filter(([, value]) => value !== undefined)
				.map(([, value]) => value),
			id,
		]
		if (updateValues.some((v) => v === undefined)) {
			throw new Error('Undefined value in updateTag parameters')
		}
		const stmt = this.#db.prepare(sql`
			UPDATE tags
			SET ${updates}, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`)
		const result = stmt.run(...updateValues)
		if (!result.changes) {
			throw new Error('Failed to update tag')
		}
		const updatedTag = await this.getTag(id)
		if (!updatedTag) {
			throw new Error('Failed to query updated tag')
		}
		this.#notifySubscribers({ tags: [id] })
		return updatedTag
	}

	async deleteTag(id: number) {
		const existingTag = await this.getTag(id)
		if (!existingTag) {
			throw new Error(`Tag with ID ${id} not found`)
		}
		const stmt = this.#db.prepare(sql`DELETE FROM tags WHERE id = ?`)
		const result = stmt.run(id)
		if (!result.changes) {
			throw new Error('Failed to delete tag')
		}
		this.#notifySubscribers({ tags: [id] })
		return true
	}

	// Entry Tag Methods
	async addTagToEntry({ entryId, tagId }: { entryId: number; tagId: number }) {
		const entry = await this.getEntry(entryId)
		if (!entry) {
			throw new Error(`Entry with ID ${entryId} not found`)
		}
		const tag = await this.getTag(tagId)
		if (!tag) {
			throw new Error(`Tag with ID ${tagId} not found`)
		}
		const stmt = this.#db.prepare(sql`
			INSERT INTO entry_tags (entry_id, tag_id)
			VALUES (?, ?)
		`)
		const result = stmt.run(entryId, tagId)
		const id =
			result.lastInsertRowid !== undefined
				? Number(result.lastInsertRowid)
				: undefined
		if (id === undefined) {
			throw new Error('Failed to add tag to entry')
		}
		const created = await this.getEntryTag(id)
		if (!created) {
			throw new Error('Failed to query created entry tag')
		}
		this.#notifySubscribers({ entries: [entryId], tags: [tagId] })
		return created
	}

	async getEntryTag(id: number) {
		const stmt = this.#db.prepare(sql`SELECT * FROM entry_tags WHERE id = ?`)
		const result = stmt.get(id)
		if (!result) return null
		return entryTagSchema.parse(snakeToCamel(result))
	}

	async getEntryTags(entryId: number) {
		const entry = await this.getEntry(entryId)
		if (!entry) {
			throw new Error(`Entry with ID ${entryId} not found`)
		}
		const stmt = this.#db.prepare(sql`
			SELECT t.* 
			FROM tags t
			JOIN entry_tags et ON et.tag_id = t.id
			WHERE et.entry_id = ?
			ORDER BY t.name
		`)
		const results = stmt.all(entryId).map((result) => snakeToCamel(result))
		return z.array(tagSchema).parse(results)
	}
}
