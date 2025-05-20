// [EO]?[-EPD _—]\d{2}(?:[-v _.—]|$)
// /[EO]?[-EPD]\d{2}(?:[-v.]|$)|[EO]?[EPD ]\d{2}(?:[v .]|$)|[EO]?[EPD_]\d{2}(?:[v_.]|$)|[EO]?[EPD—]\d{2}(?:[v.—]|$)|\d{2} ?[-~—] ?\d{2}/i
// matches: OP01 ED01 EP01 E01 01v 01. -01- _01_ with spaces and stuff
export const epNumRx = /[EO]?[-EPD]\d{2}(?:[-v.]|$)|[EO]?[EPD ]\d{2}(?:[v .]|$)|[EO]?[EPD_]\d{2}(?:[v_.]|$)|[EO]?[EPD—]\d{2}(?:[v.—]|$)|\d{2} ?[-~—] ?\d{2}/i

const     queryObjects = /* js */`
id,
idMal,
title {
  romaji,
  english,
  native,
  userPreferred
},
description(asHtml: false),
season,
seasonYear,
format,
status,
episodes,
duration,
averageScore,
genres,
tags {
  name,
  rank
},
isFavourite,
coverImage {
  extraLarge,
  medium,
  color
},
source,
countryOfOrigin,
isAdult,
bannerImage,
synonyms,
studios(sort: NAME, isMain: true) {
  nodes {
    name
  }
},
stats {
  scoreDistribution {
    score,
    amount
    }
},
nextAiringEpisode {
  timeUntilAiring,
  episode
},
trailer {
  id,
  site
},
streamingEpisodes {
  title,
  thumbnail
},
mediaListEntry {
  id,
  progress,
  repeat,
  status,
  customLists(asArray: true),
  score(format: POINT_10),
  startedAt {
    year,
    month,
    day
  },
  completedAt {
    year,
    month,
    day
  }
},
airingSchedule(page: 1, perPage: 1, notYetAired: true) {
  nodes {
    episode,
    airingAt
  }
},
relations {
  edges {
    relationType(version:2),
    node {
      id,
      type,
      format,
      seasonYear
    }
  }
}`

export default new class Utils {

    epstring = ep => `"E${this.zeropad(ep)}+"|"E${this.zeropad(ep)}v"|"+${this.zeropad(ep)}+"|"+${this.zeropad(ep)}v"`

//  padleft a variable with 0 ex: 1 => '01'
    zeropad (v = 1, l = 2) {
        return (typeof v === 'string' ? v : v.toString()).padStart(l, '0')
    }

//  create an array of potentially valid titles from a given media
    createTitle (_titles) {
        // group and de-duplicate
        const grouped = [...new Set(
            Object.values(_titles.title)
                .concat(_titles.synonyms)
                .filter(name => name != null && name.length > 3)
        )]
        const titles = []
        const appendTitle = t => {
            // replace & with encoded
            const title = t.replace(/&/g, '%26').replace(/\?/g, '%3F').replace(/#/g, '%23')
            titles.push(title)

            // replace Season 2 with S2, else replace 2nd Season with S2, but keep the original title
            const match1 = title.match(/(\d)(?:nd|rd|th) Season/i)
            const match2 = title.match(/Season (\d)/i)

            if (match2) {
                titles.push(title.replace(/Season \d/i, `S${match2[1]}`))
            } else if (match1) {
                titles.push(title.replace(/(\d)(?:nd|rd|th) Season/i, `S${match1[1]}`))
            }
        }
        for (const t of grouped) {
            appendTitle(t)
            if (t.includes('-')) appendTitle(t.replaceAll('-', ''))
        }
        return titles
    }

    findEdge (media, type, formats = ['TV', 'TV_SHORT'], skip) {
        let res = media.relations.edges.find(edge => {
            if (edge.relationType === type) {
                return formats.includes(edge.node.format)
            }
            return false
        })
        // this is hit-miss
        if (!res && !skip && type === 'SEQUEL') res = this.findEdge(media, type, formats = ['TV', 'TV_SHORT', 'OVA'], true)
        return res
    }

    getMediaMaxEp (media, playable) {
        if (playable) {
            return media.nextAiringEpisode?.episode - 1 || media.airingSchedule?.nodes?.[0]?.episode - 1 || media.episodes
        } else {
            return media.episodes || media.nextAiringEpisode?.episode - 1 || media.airingSchedule?.nodes?.[0]?.episode - 1
        }
    }

    convertSizeToBytes(size) {
        const sizeRegex = /^([\d.]+)\s*(MiB|KiB|GiB|B)$/
        const match = size.match(sizeRegex)

        if (!match) return 0 // Return 0 if the format is not recognized

        const value = parseFloat(match[1])
        const unit = match[2]

        switch (unit) {
            case 'GiB':
                return value * 1024 * 1024 * 1024 // GiB to bytes
            case 'MiB':
                return value * 1024 * 1024 // MiB to bytes
            case 'KiB':
                return value * 1024 // KiB to bytes
            case 'B':
                return value // already in bytes
            default:
                return 0 // In case of an unrecognized unit
        }
    }

    /**
     * @param {number} id
     */
    async getAnimeById(id) {
        const res = await this.searchIDSingle({id})

        return res.data.Media
    }

    async resolveSeason(opts) {
        // media, episode, increment, offset, force
        if (!opts.media || !(opts.episode || opts.force)) throw new Error('No episode or media for season resolve!')

        let {media, episode, increment, offset = 0, rootMedia = opts.media, force} = opts

        const rootHighest = (rootMedia.nextAiringEpisode?.episode || rootMedia.episodes)

        const prequel = !increment && this.findEdge(media, 'PREQUEL')?.node
        const sequel = !prequel && (increment || increment == null) && this.findEdge(media, 'SEQUEL')?.node
        const edge = prequel || sequel
        increment = increment ?? !prequel

        if (!edge) {
            return {media, episode: episode - offset, offset, increment, rootMedia, failed: true}
        }
        media = await this.getAnimeById(edge.id)

        const highest = media.nextAiringEpisode?.episode || media.episodes

        const diff = episode - (highest + offset)
        offset += increment ? rootHighest : highest
        if (increment) rootMedia = media

        // force marches till end of tree, no need for checks
        if (!force && diff <= rootHighest) {
            episode -= offset
            return {media, episode, offset, increment, rootMedia}
        }

        return this.resolveSeason({media, episode, increment, offset, rootMedia, force})
    }

    async getRSSContent(url) {
        if (!url) return null
        try {
            const res = await fetch(url)
            if (!res.ok) {
                throw new Error('Failed fetching RSS!\n' + res.statusText)
            }
            const xml = await res.text()
            return this.createDOM(xml) // Return a custom DOM-like structure
        } catch (e) {
            throw new Error('Failed fetching RSS!\n' + e.message)
        }
    }

    createDOM(xml) {
        const wrapper = {
            querySelectorAll: (selector) => {
                const items = []
                const itemRegex = /<item>([\s\S]*?)<\/item>/g
                let match

                while ((match = itemRegex.exec(xml)) !== null) {
                    items.push(match[1]) // Push the raw item content
                }

                return items.map(item => this.createItemElement(item))
            },
            querySelector: (selector) => {
                const item = wrapper.querySelectorAll('item')[0] // Get the first <item>
                return item ? item.getElementsByTagName(selector)[0] : null
            }
        }

        return wrapper
    }

    createItemElement(item) {
        return {
            innerHTML: item,
            getElementsByTagName: (tagName) => {
                const tagRegex = new RegExp(`<${tagName}>([\\s\\S]*?)<\\/${tagName}>`, 'g')
                const tags = []
                let tagMatch

                while ((tagMatch = tagRegex.exec(item)) !== null) {
                    tags.push({
                        textContent: tagMatch[1].trim(),
                        attributes: {} // Add attributes if needed
                    })
                }
                return tags
            },
            querySelector: function(selector) {
                const found = this.getElementsByTagName(selector)
                return found.length > 0 ? found[0] : null
            }
        }
    }

    // handle queries...

    async searchIDSingle (variables) {
        const query = /* js */` 
        query($id: Int) { 
          Media(id: $id, type: ANIME) {
            ${queryObjects}
          }
        }`
        return await this.alRequest(query, variables)
    }

    /**
     * @param {string} query
     * @param {Record<string, any>} variables
     */
    alRequest (query, variables) {
        /** @type {RequestInit} */
        const options = {
            method: 'POST',
            credentials: 'omit',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                query: query.replace(/\s/g, '').replaceAll('&nbsp;', ' '),
                variables: {
                    page: 1,
                    perPage: 50,
                    status_in: '[CURRENT,PLANNING,COMPLETED,DROPPED,PAUSED,REPEATING]',
                    ...variables
                }
            })
        }

        return this.handleRequest(options)
    }

    /** @type {(options: RequestInit) => Promise<any>} */
    handleRequest = (async opts => {
        let res = {}
        try {
            res = await fetch('https://graphql.anilist.co', opts)
        } catch (e) {
            if (!res || res.status !== 404) throw e
        }
        if (!res.ok && (res.status === 429 || res.status === 500)) {
            throw res
        }
        let json = null
        try {
            json = await res.json()
        } catch (error) {
            throw error
        }
        return json
    })
}