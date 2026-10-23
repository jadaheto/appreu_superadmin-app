/** Paging request understood by every repository that lists records. */
export interface PageRequest {
  /** 1-based page number. */
  page: number;
  /** Page size. */
  limit: number;
}

/** A page of results plus the total count of matching records. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

/** Translates a page request into SQL offset. */
export const toOffset = ({ page, limit }: PageRequest): number => (Math.max(page, 1) - 1) * limit;

/** Maps the items of a page keeping the paging metadata. */
export const mapPage = <A, B>(page: Paginated<A>, fn: (item: A) => B): Paginated<B> => ({
  ...page,
  items: page.items.map(fn),
});
