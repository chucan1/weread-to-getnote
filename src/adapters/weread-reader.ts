import type { SourceAdapter } from "./interfaces";
import type { NoteIR, Resource, PlatformConfig } from "../ir/schema";
import { IR_VERSION } from "../ir/schema";

const GATEWAY = "https://i.weread.qq.com/api/agent/gateway";
const SKILL_VERSION = "1.0.3";

interface WereadBook {
  bookId: string;
  title: string;
  author: string;
  cover?: string;
  noteCount: number;
  reviewCount: number;
  bookmarkCount: number;
}

interface WereadBookmark {
  bookmarkId: string;
  chapterUid: number;
  markText: string;
  range: string;
  chapterName: string;
  bookName?: string;
  reviews?: WereadReview[];
}

interface WereadReview {
  reviewId: string;
  chapterUid: number;
  range: string;
  content: string;
}

interface WereadChapter {
  chapterUid: number;
  title: string;
}

async function apiCall<T>(
  apiName: string,
  params: Record<string, unknown>,
  apiKey: string,
): Promise<T> {
  const body = JSON.stringify({ api_name: apiName, skill_version: SKILL_VERSION, ...params });
  const resp = await fetch(GATEWAY, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!resp.ok) {
    throw new Error(`WeRead API error: ${resp.status} ${resp.statusText}`);
  }
  return resp.json() as T;
}

function wereadBookToResource(b: WereadBook): Resource {
  return {
    id: b.bookId,
    title: b.title,
    author: b.author,
    note_count: b.noteCount + b.reviewCount + b.bookmarkCount,
    extra: { cover: b.cover },
  };
}

export const wereadReader: SourceAdapter = {
  platform: "weread",
  version: "0.1.0",

  async healthCheck(config: PlatformConfig): Promise<boolean> {
    try {
      const key = config.credential["api_key"];
      if (!key) return false;
      await apiCall<unknown>("/user/notebooks", { count: 1 }, key);
      return true;
    } catch {
      return false;
    }
  },

  async listResources(config: PlatformConfig): Promise<Resource[]> {
    const key = config.credential["api_key"];
    if (!key) throw new Error("WeRead API key not configured (credential.api_key)");

    const allBooks: WereadBook[] = [];
    let lastSort: number | undefined;

    do {
      const params: Record<string, unknown> = { count: 100 };
      if (lastSort !== undefined) params["lastSort"] = lastSort;
      const resp = await apiCall<{ books: WereadBook[]; lastSort?: number }>(
        "/user/notebooks",
        params,
        key,
      );
      allBooks.push(...(resp.books ?? []));
      lastSort = resp.lastSort;
    } while (lastSort !== undefined);

    return allBooks
      .filter((b) => b.noteCount + b.reviewCount + b.bookmarkCount > 0)
      .map(wereadBookToResource);
  },

  async fetch(resource: Resource, config: PlatformConfig): Promise<NoteIR[]> {
    const key = config.credential["api_key"];
    if (!key) throw new Error("WeRead API key not configured");

    const bookId = resource.id;
    const bookTitle = resource.title;
    const author = resource.author ?? "";

    // Fetch chapter info for grouping
    let chapters = new Map<number, string>();
    try {
      const chapterData = await apiCall<{ chapters: WereadChapter[] }>(
        "/book/chapterinfo",
        { bookId },
        key,
      );
      for (const ch of chapterData.chapters ?? []) {
        chapters.set(ch.chapterUid, ch.title);
      }
    } catch {
      // chapter info is optional for adapter to work
    }

    // Fetch bookmarks
    const bmData = await apiCall<{ bookmarks: WereadBookmark[]; bookmarkCount: number }>(
      "/book/bookmarklist",
      { bookId },
      key,
    );

    const bookmarks = bmData.bookmarks ?? [];

    // Fetch reviews (thoughts on the book)
    let allReviews: WereadReview[] = [];
    let cursor: string | undefined;
    do {
      const params: Record<string, unknown> = { bookId };
      if (cursor) params["cursor"] = cursor;
      const revData = await apiCall<{ reviews: WereadReview[]; cursor?: string }>(
        "/review/list/mine",
        params,
        key,
      );
      allReviews.push(...(revData.reviews ?? []));
      cursor = revData.cursor;
    } while (cursor);

    // Convert bookmarks to NoteIR
    const notes: NoteIR[] = [];
    const now = new Date().toISOString();

    for (const bm of bookmarks) {
      const chName = chapters.get(bm.chapterUid) ?? `章节 ${bm.chapterUid}`;
      const [rangeStart, rangeEnd] = (bm.range ?? "0-0").split("-");
      const sourceUrl = rangeEnd
        ? `weread://bestbookmark?bookId=${bookId}&chapterUid=${bm.chapterUid}&rangeStart=${rangeStart}&rangeEnd=${rangeEnd}`
        : `weread://reading?bId=${bookId}&chapterUid=${bm.chapterUid}`;

      // Associated reviews (thoughts) on this bookmark
      const children: NoteIR[] = (bm.reviews ?? [])
        .filter((r) => r.content && r.content.trim())
        .map((r) => ({
          ir_version: IR_VERSION,
          source: "weread",
          source_note_id: `review_${r.reviewId}`,
          fetched_at: now,
          title: null,
          content: r.content,
          content_type: "thought" as const,
          children: [],
          book_title: bookTitle,
          chapter_title: chName,
          author,
          source_url: null,
          tags: [],
          extra: {
            bookId,
            chapterUid: String(bm.chapterUid),
            reviewId: r.reviewId,
            range: bm.range,
          },
        }));

      notes.push({
        ir_version: IR_VERSION,
        source: "weread",
        source_note_id: `bookmark_${bm.bookmarkId}`,
        fetched_at: now,
        title: bm.markText.slice(0, 50),
        content: bm.markText,
        content_type: "highlight",
        children,
        book_title: bookTitle,
        chapter_title: chName,
        author,
        source_url: sourceUrl,
        tags: [],
        extra: {
          bookId,
          chapterUid: String(bm.chapterUid),
          range: bm.range,
        },
      });
    }

    // Add standalone thoughts (not tied to a specific bookmark)
    const attachedReviewIds = new Set(
      bookmarks.flatMap((bm) => (bm.reviews ?? []).map((r) => r.reviewId)),
    );
    for (const rev of allReviews) {
      if (attachedReviewIds.has(rev.reviewId)) continue;
      if (!rev.content?.trim()) continue;

      notes.push({
        ir_version: IR_VERSION,
        source: "weread",
        source_note_id: `review_${rev.reviewId}`,
        fetched_at: now,
        title: rev.content.slice(0, 50),
        content: rev.content,
        content_type: "thought",
        children: [],
        book_title: bookTitle,
        chapter_title: null,
        author,
        source_url: null,
        tags: [],
        extra: { bookId, reviewId: rev.reviewId },
      });
    }

    return notes;
  },

  async fetchIncremental(
    resource: Resource,
    since: Date,
    config: PlatformConfig,
  ): Promise<NoteIR[]> {
    // WeRead API doesn't support filtering by date — fetch all, filter locally
    const all = await this.fetch(resource, config);
    return all.filter((n) => new Date(n.fetched_at) >= since);
  },
};
