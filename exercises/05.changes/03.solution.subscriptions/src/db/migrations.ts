import { type DatabaseSync } from 'node:sqlite'
import { sql } from './utils.ts'

const migrations = [
	{
		version: 1,
		name: 'initial_schema',
		up: (db: DatabaseSync) => {
			console.error('Starting initial schema migration...')
			try {
				db.exec(sql`
					CREATE TABLE IF NOT EXISTS schema_versions (
						version INTEGER PRIMARY KEY,
						name TEXT NOT NULL,
						applied_at INTEGER DEFAULT (CURRENT_TIMESTAMP) NOT NULL
					);
				`)
				db.exec(sql`
					CREATE TABLE IF NOT EXISTS entries (
						id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
						title text NOT NULL,
						content text NOT NULL,
						mood text,
						location text,
						weather text,
						is_private integer DEFAULT 1 NOT NULL CHECK (is_private IN (0, 1)),
						is_favorite integer DEFAULT 0 NOT NULL CHECK (is_favorite IN (0, 1)),
						created_at integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
						updated_at integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
					);
					CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at);
					CREATE INDEX IF NOT EXISTS idx_entries_is_private ON entries(is_private);
				`)
				db.exec(sql`
					CREATE TABLE IF NOT EXISTS tags (
						id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
						name text NOT NULL UNIQUE,
						description text,
						created_at integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
						updated_at integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
					);
				`)
				db.exec(sql`
					CREATE TABLE IF NOT EXISTS entry_tags (
						id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
						entry_id integer NOT NULL,
						tag_id integer NOT NULL,
						created_at integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
						updated_at integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
						FOREIGN KEY (entry_id) REFERENCES entries(id) ON DELETE CASCADE,
						FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
						UNIQUE(entry_id, tag_id)
					);
					CREATE INDEX IF NOT EXISTS idx_entry_tags_entry ON entry_tags(entry_id);
					CREATE INDEX IF NOT EXISTS idx_entry_tags_tag ON entry_tags(tag_id);
				`)
				console.error('Successfully created all tables')
			} catch (error) {
				console.error('Error in initial schema migration:', error)
				throw error
			}
		},
	},
	// Add future migrations here with incrementing version numbers
]

// Run migrations
export function migrate(db: DatabaseSync) {
	console.error('Starting migration process...')
	try {
		db.exec(sql`
			CREATE TABLE IF NOT EXISTS schema_versions (
				version INTEGER PRIMARY KEY,
				name TEXT NOT NULL,
				applied_at INTEGER DEFAULT (CURRENT_TIMESTAMP) NOT NULL
			);
		`)
		const stmt = db.prepare(
			sql`SELECT MAX(version) as version FROM schema_versions;`,
		)
		const result = stmt.get()
		const currentVersion = result?.version ? Number(result.version) : 0
		console.error('Current schema version:', currentVersion)
		for (const migration of migrations) {
			if (Number(migration.version) > currentVersion) {
				console.error(
					`Running migration ${migration.version}: ${migration.name}`,
				)
				migration.up(db)
				db.prepare(
					sql`INSERT INTO schema_versions (version, name) VALUES (?, ?);`,
				).run(migration.version, migration.name)
				console.error(`Completed migration ${migration.version}`)
			}
		}
		console.error('Migration process completed successfully')
	} catch (error) {
		console.error('Error during migration process:', error)
		throw error
	}
}
