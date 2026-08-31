import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import type { Database } from './db';
import { games, categories, publishers } from '../../db/schema';
import type { Category, Game, Publisher } from '../types/game';

const gameSelection = {
    id: games.id,
    title: games.title,
    description: games.description,
    starRating: games.starRating,
    categoryId: categories.id,
    categoryName: categories.name,
    categoryDescription: categories.description,
    publisherId: publishers.id,
    publisherName: publishers.name,
    publisherDescription: publishers.description,
};

type GameSelectionRow = {
    id: number;
    title: string;
    description: string;
    starRating: number | null;
    categoryId: number | null;
    categoryName: string | null;
    categoryDescription: string | null;
    publisherId: number | null;
    publisherName: string | null;
    publisherDescription: string | null;
};

function mapGame(row: GameSelectionRow): Game {
    return {
        id: row.id,
        title: row.title,
        description: row.description,
        starRating: row.starRating,
        category:
            row.categoryId !== null && row.categoryName !== null
                ? { id: row.categoryId, name: row.categoryName, description: row.categoryDescription }
                : null,
        publisher:
            row.publisherId !== null && row.publisherName !== null
                ? { id: row.publisherId, name: row.publisherName, description: row.publisherDescription }
                : null,
    };
}

function baseGamesQuery(db: Database) {
    return db
        .select(gameSelection)
        .from(games)
        .leftJoin(categories, eq(games.categoryId, categories.id))
        .leftJoin(publishers, eq(games.publisherId, publishers.id));
}

export interface GameFilters {
    categoryIds?: number[];
    publisherId?: number;
}

export interface PaginatedGames {
    games: Game[];
    currentPage: number;
    pageSize: number;
    totalGames: number;
    totalPages: number;
}

export interface CatalogSummary {
    totalGames: number;
    averageRating: number | null;
}

export interface PublisherDetails {
    id: number;
    name: string;
    description: string | null;
}

/** All games ordered by title. */
export async function getAllGames(db: Database): Promise<Game[]> {
    const rows = await baseGamesQuery(db).orderBy(asc(games.title));
    return rows.map(mapGame);
}

/**
 * Returns one page of games in stable title and id order.
 *
 * @param db Injectable database client used by pages and tests.
 * @param page One-based page number.
 * @param pageSize Maximum number of games returned per page.
 * @returns The requested games and pagination metadata.
 */
export async function getPaginatedGames(
    db: Database,
    page: number,
    pageSize: number,
): Promise<PaginatedGames> {
    if (!Number.isInteger(page) || page < 1) {
        throw new RangeError('page must be a positive integer');
    }
    if (!Number.isInteger(pageSize) || pageSize < 1) {
        throw new RangeError('pageSize must be a positive integer');
    }

    const [{ totalGames }] = await db.select({ totalGames: count() }).from(games);
    const rows = await baseGamesQuery(db)
        .orderBy(asc(games.title), asc(games.id))
        .limit(pageSize)
        .offset((page - 1) * pageSize);

    return {
        games: rows.map(mapGame),
        currentPage: page,
        pageSize,
        totalGames,
        totalPages: Math.ceil(totalGames / pageSize),
    };
}

/**
 * Returns the catalog size and average of the available star ratings.
 *
 * @param db Injectable database client used by pages and tests.
 * @returns Catalog totals, with a null average when no games are rated.
 */
export async function getCatalogSummary(db: Database): Promise<CatalogSummary> {
    const [{ totalGames }] = await db.select({ totalGames: count() }).from(games);
    const ratedGames = await db
        .select({ starRating: games.starRating })
        .from(games)
        .where(sql`${games.starRating} IS NOT NULL`);
    const averageRating =
        ratedGames.length > 0
            ? ratedGames.reduce((total, game) => total + (game.starRating ?? 0), 0) / ratedGames.length
            : null;

    return { totalGames, averageRating };
}

/**
 * Returns a publisher's details, or null when the id is unknown.
 *
 * @param db Injectable database client used by pages and tests.
 * @param id Publisher identifier.
 * @returns Publisher details or null when no publisher matches.
 */
export async function getPublisherById(db: Database, id: number): Promise<PublisherDetails | null> {
    const publisher = await db
        .select({ id: publishers.id, name: publishers.name, description: publishers.description })
        .from(publishers)
        .where(eq(publishers.id, id))
        .get();
    return publisher ?? null;
}

/**
 * Returns all games belonging to a publisher in stable title order.
 *
 * @param db Injectable database client used by pages and tests.
 * @param publisherId Publisher identifier used to filter games.
 * @returns Games published by the requested publisher.
 */
export async function getGamesByPublisher(db: Database, publisherId: number): Promise<Game[]> {
    const rows = await baseGamesQuery(db)
        .where(eq(games.publisherId, publisherId))
        .orderBy(asc(games.title), asc(games.id));
    return rows.map(mapGame);
}

/** Games filtered by category ids (OR) and publisher id (AND), ordered by title. */
export async function getFilteredGames(db: Database, filters: GameFilters): Promise<Game[]> {
    const normalizedCategoryIds = (filters.categoryIds ?? []).filter((id) => Number.isInteger(id) && id > 0);
    const normalizedPublisherId =
        typeof filters.publisherId === 'number' && Number.isInteger(filters.publisherId) && filters.publisherId > 0
            ? filters.publisherId
            : undefined;

    const whereClauses = [
        ...(normalizedCategoryIds.length > 0 ? [inArray(games.categoryId, normalizedCategoryIds)] : []),
        ...(normalizedPublisherId !== undefined ? [eq(games.publisherId, normalizedPublisherId)] : []),
    ];

    const query = baseGamesQuery(db);
    const rows =
        whereClauses.length > 0
            ? await query.where(and(...whereClauses)).orderBy(asc(games.title))
            : await query.orderBy(asc(games.title));

    return rows.map(mapGame);
}

/** All categories ordered by name for filter controls. */
export async function getAllCategories(db: Database): Promise<Category[]> {
    const rows = await db.select({ id: categories.id, name: categories.name }).from(categories).orderBy(asc(categories.name));
    return rows;
}

/** All publishers ordered by name for filter controls. */
export async function getAllPublishers(db: Database): Promise<Publisher[]> {
    const rows = await db.select({ id: publishers.id, name: publishers.name }).from(publishers).orderBy(asc(publishers.name));
    return rows;
}

/** All game ids ordered by title. */
export async function getAllGameIds(db: Database): Promise<number[]> {
    const rows = await db.select({ id: games.id }).from(games).orderBy(asc(games.title));
    return rows.map((row) => row.id);
}

/** A single game by id, or null when it does not exist. */
export async function getGameById(db: Database, id: number): Promise<Game | null> {
    const row = await baseGamesQuery(db).where(eq(games.id, id)).get();
    return row ? mapGame(row) : null;
}
