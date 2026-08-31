import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDatabase } from '../../db/test-helpers';
import { categories, publishers, games } from '../../db/schema';
import type { Database } from './db';
import {
    getAllCategories,
    getAllGames,
    getAllGameIds,
    getGameById,
    getAllPublishers,
    getFilteredGames,
    getPaginatedGames,
} from './games';

async function seedGames(db: Database, count: number): Promise<void> {
    const [category] = await db
        .insert(categories)
        .values({ name: 'Strategy', description: 'cat' })
        .returning({ id: categories.id });
    const [publisher] = await db
        .insert(publishers)
        .values({ name: 'Pub One', description: 'pub' })
        .returning({ id: publishers.id });

    // Insert titles in reverse-alphabetical order to prove ordering is applied.
    for (let i = count; i >= 1; i--) {
        await db.insert(games).values({
            title: `Game ${String(i).padStart(2, '0')}`,
            description: `Description ${i}`,
            starRating: 4.2,
            categoryId: category.id,
            publisherId: publisher.id,
        });
    }
}

async function seedFilterFixture(targetDb: Database): Promise<{
    strategyId: number;
    puzzleId: number;
    novaId: number;
    pixelId: number;
}> {
    const [strategy] = await targetDb.insert(categories).values({ name: 'Strategy', description: 's' }).returning({ id: categories.id });
    const [puzzle] = await targetDb.insert(categories).values({ name: 'Puzzle', description: 'p' }).returning({ id: categories.id });
    const [nova] = await targetDb.insert(publishers).values({ name: 'Nova Forge', description: 'n' }).returning({ id: publishers.id });
    const [pixel] = await targetDb.insert(publishers).values({ name: 'Pixel Peak', description: 'x' }).returning({ id: publishers.id });

    await targetDb.insert(games).values([
        { title: 'Alpha Tactics', description: 'A', starRating: 4.1, categoryId: strategy.id, publisherId: nova.id },
        { title: 'Beta Blocks', description: 'B', starRating: 4.0, categoryId: puzzle.id, publisherId: nova.id },
        { title: 'Gamma Grid', description: 'G', starRating: 4.5, categoryId: strategy.id, publisherId: pixel.id },
    ]);

    return { strategyId: strategy.id, puzzleId: puzzle.id, novaId: nova.id, pixelId: pixel.id };
}

describe('games data-access helpers', () => {
    let db: Database;

    beforeEach(async () => {
        db = await createTestDatabase();
    });

    describe('filtering helpers', () => {
        let db: Database;

        beforeEach(async () => {
            db = await createTestDatabase();
        });

        it('filters by multiple categories', async () => {
            const ids = await seedFilterFixture(db);
            const result = await getFilteredGames(db, { categoryIds: [ids.puzzleId, ids.strategyId] });
            expect(result.map((g) => g.title)).toEqual(['Alpha Tactics', 'Beta Blocks', 'Gamma Grid']);
        });

        it('filters by single publisher', async () => {
            const ids = await seedFilterFixture(db);
            const result = await getFilteredGames(db, { publisherId: ids.pixelId });
            expect(result.map((g) => g.title)).toEqual(['Gamma Grid']);
        });

        it('combines category and publisher filters', async () => {
            const ids = await seedFilterFixture(db);
            const result = await getFilteredGames(db, { categoryIds: [ids.strategyId], publisherId: ids.novaId });
            expect(result.map((g) => g.title)).toEqual(['Alpha Tactics']);
        });

        it('returns empty list when no game matches filters', async () => {
            const ids = await seedFilterFixture(db);
            const result = await getFilteredGames(db, { categoryIds: [ids.puzzleId], publisherId: ids.pixelId });
            expect(result).toEqual([]);
        });

        it('ignores invalid filter ids', async () => {
            await seedFilterFixture(db);
            const result = await getFilteredGames(db, { categoryIds: [0, -1], publisherId: -10 });
            expect(result.map((g) => g.title)).toEqual(['Alpha Tactics', 'Beta Blocks', 'Gamma Grid']);
        });

        it('returns categories and publishers ordered by name', async () => {
            await seedFilterFixture(db);
            const categoryNames = (await getAllCategories(db)).map((c) => c.name);
            const publisherNames = (await getAllPublishers(db)).map((p) => p.name);
            expect(categoryNames).toEqual(['Puzzle', 'Strategy']);
            expect(publisherNames).toEqual(['Nova Forge', 'Pixel Peak']);
        });
    });

    it('returns all games ordered by title', async () => {
        await seedGames(db, 3);
        const all = await getAllGames(db);
        expect(all.map((g) => g.title)).toEqual(['Game 01', 'Game 02', 'Game 03']);
        expect(all[0].category).toEqual({ id: expect.any(Number), name: 'Strategy' });
        expect(all[0].publisher).toEqual({ id: expect.any(Number), name: 'Pub One' });
    });

    it('returns all game ids ordered by title', async () => {
        await seedGames(db, 3);
        const ids = await getAllGameIds(db);
        const all = await getAllGames(db);
        expect(ids).toEqual(all.map((g) => g.id));
    });

    describe('getPaginatedGames', () => {
        it('returns the requested page in title order with pagination metadata', async () => {
            await seedGames(db, 5);

            const result = await getPaginatedGames(db, 2, 2);

            expect(result.games.map((game) => game.title)).toEqual(['Game 03', 'Game 04']);
            expect(result).toMatchObject({
                currentPage: 2,
                pageSize: 2,
                totalGames: 5,
                totalPages: 3,
            });
        });

        it('returns an empty page for an empty database', async () => {
            const result = await getPaginatedGames(db, 1, 9);

            expect(result.games).toEqual([]);
            expect(result.totalGames).toBe(0);
            expect(result.totalPages).toBe(0);
        });

        it.each([
            { page: 0, pageSize: 9 },
            { page: 1.5, pageSize: 9 },
            { page: 1, pageSize: 0 },
            { page: 1, pageSize: 2.5 },
        ])('rejects invalid pagination values %#', async ({ page, pageSize }) => {
            await expect(getPaginatedGames(db, page, pageSize)).rejects.toThrow(RangeError);
        });
    });

    it('fetches a single game by id', async () => {
        await seedGames(db, 2);
        const ids = await getAllGameIds(db);
        const game = await getGameById(db, ids[0]);
        expect(game?.title).toBe('Game 01');
    });

    it('returns null for a non-existent game', async () => {
        await seedGames(db, 2);
        expect(await getGameById(db, 99999)).toBeNull();
    });
});
