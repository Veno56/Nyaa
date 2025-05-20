export interface Result {
  title: string,
  link: string,
  id?: number,
  seeders: number,
  leechers: number,
  downloads: number,
  hash: string,
  size: number,
  verified: boolean,
  date: Date,
  type?: 'batch' | 'best' | 'alt'
}

export interface Options {
  anilistId?: number,
  anidbAid?: number,
  anidbEid?: number,
  titles?: string[],
  episode?: number,
  episodeCount?: number,
  resolution?: string,
  exclusions?: string[],
}

export type SearchFunction = (options: Options) => Promise<Result[]>

export type Config = {
  seed?: 'perma' | number // seed ratio to hit
}

export type Accuracy = 'High' | 'Medium' | 'Low'

export interface NyaaElement {
  querySelector: (selector: string) => {
    textContent?: string | null;
    attributes?: { url?: { value: string } };
  } | null;
}
