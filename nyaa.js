import AbstractSource from './abstract.js'
import Utils from './utils.js'
import {epNumRx} from './utils.js'

export default new class Nyaa extends AbstractSource {
    name = 'Nyaa'
    description = 'Nyaa is a public, closed tracker. Offers no good API or searches, and its searches are generally accurate.'
    /** @type {import('./types.js').Accuracy} */
    accuracy = 'Medium'

    url = atob('aHR0cHM6Ly9ueWFhLnNp')

    /**
     * @param {NyaaElement[]} nodes
     * @param {boolean} batch
     * @returns {import('./types.js').Result[]}
     **/
    map (nodes, batch = false) {
        return nodes.map(item => {
            const pubDate = item.querySelector('pubDate')?.textContent
            return {
                title: item.querySelector('title')?.textContent || '?',
                link: item.querySelector('enclosure')?.attributes.url.value || item.querySelector('link')?.textContent || '?',
                hash: item.querySelector('nyaa\\:infoHash')?.textContent ?? '?',
                seeders: item.querySelector('nyaa\\:seeders')?.textContent ?? '?',
                leechers: item.querySelector('nyaa\\:leechers')?.textContent ?? '?',
                downloads: item.querySelector('nyaa\\:downloads')?.textContent ?? '?',
                size: Utils.convertSizeToBytes(item.querySelector('nyaa\\:size')?.textContent ?? '?'),
                verified: item.querySelector('nyaa\\:trusted')?.textContent?.includes("Yes") || item.querySelector('nyaa\\:remake')?.textContent?.includes("Yes"),
                type: batch ? 'batch' : undefined,
                date: pubDate && new Date(pubDate)
            }
        })
    }

    /** @type {import('./types.js').SearchFunction} */
    async single ({ anilistId, media, episode, exclusions, resolution, mode, ignoreQuality }) {
        // mode cuts down on the amt of queries made 'check' || 'batch'
        if (!media) media = (await Utils.searchIDSingle({ id: anilistId })).data.Media
        const titles = Utils.createTitle(media).join(')|(')

        const prequel = Utils.findEdge(media, 'PREQUEL')?.node
        const sequel = Utils.findEdge(media, 'SEQUEL')?.node
        const isBatch = media.status === 'FINISHED' && media.episodes !== 1

        // if media has multiple seasons, and this S is > 1, then get the absolute episode number of the episode
        const absolute = prequel && !mode && (await Utils.resolveSeason({ media, episode, force: true }))
        const absoluteep = absolute?.offset + episode
        const episodes = [episode]

        // only use absolute episode number if its smaller than max episodes this series has, ex:
        // looking for E1 of S2, S1 has 12 ep and S2 has 13, absolute will be 13
        // so this would find the 13th ep of the 2nd season too if this check wasnt here
        if (absolute && absoluteep < (Utils.getMediaMaxEp(media) || episode)) {
            episodes.push(absoluteep)
        }

        let ep = ''
        if (media.episodes !== 1 && mode !== 'batch') {
            if (isBatch) {
                const digits = Math.max(2, Math.log(media.episodes) * Math.LOG10E + 1 | 0)
                ep = `"${Utils.zeropad(1, digits)}-${Utils.zeropad(media.episodes, digits)}"|"${Utils.zeropad(1, digits)}~${Utils.zeropad(media.episodes, digits)}"|"Batch"|"Complete"|"${Utils.zeropad(episode)}+"|"${Utils.zeropad(episode)}v"`
            } else {
                ep = `(${episodes.map(Utils.epstring).join('|')})`
            }
        }

        const excl = exclusions && exclusions.join('|')
        const quality = (!ignoreQuality && (`"${resolution}"` || '"1080"')) || ''
        const baseUrl = `${this.url}?page=rss&c=1_2&f=0&s=seeders&o=desc&q=(${titles})${ep}${quality ? quality : ''}`;
        const url = new URL(excl ? `${baseUrl}-(${excl})` : baseUrl);

        let nodes = [...(await Utils.getRSSContent(url)).querySelectorAll('item')]

        if (absolute) {
            // if this is S > 1 aka absolute ep number exists get entries for S1title + absoluteEP
            // the reason this isn't done with recursion like sequelEntries is because that would include the S1 media dates
            // we want the dates of the target media as the S1 title might be used for SX releases
            const titles = Utils.createTitle(absolute.media).join(')|(')

            const baseUrl = `${this.url}?page=rss&c=1_2&f=0&s=seeders&o=desc&q=(${titles})${Utils.epstring(absoluteep)}${quality ? quality : ''}`;
            const url = new URL(excl ? `${baseUrl}-(${excl})` : baseUrl);

            nodes = [...nodes, ...(await Utils.getRSSContent(url)).querySelectorAll('item')]
        }

        let entries = this.map(nodes, mode === 'batch')

        const checkSequelDate = media.status === 'FINISHED' && (sequel?.status === 'FINISHED' || sequel?.status === 'RELEASING') && sequel.startDate

        const sequelStartDate = checkSequelDate && new Date(Object.values(checkSequelDate).join(' '))

        // recursive, get all entries for media sequel, and its sequel, and its sequel
        const sequelEntries =
            (sequel?.status === 'FINISHED' || sequel?.status === 'RELEASING') &&
            (await this.single({ media: (await Utils.searchIDSingle({ id: sequel.id })).data.Media, episode, mode: mode || 'check' }))

        const checkPrequelDate = (media.status === 'FINISHED' || media.status === 'RELEASING') && prequel?.status === 'FINISHED' && prequel?.endDate

        const prequelEndDate = checkPrequelDate && new Date(Object.values(checkPrequelDate).join(' '))

        // 1 month in MS, a bit of jitter for pre-releases and releasers being late as fuck, lets hope it doesn't cause issues
        const month = 2674848460

        if (prequelEndDate) {
            entries = entries.filter(entry => entry.date > new Date(+prequelEndDate + month))
        }

        if (sequelStartDate && media.format === 'TV') {
            entries = entries.filter(entry => entry.date < new Date(+sequelStartDate - month))
        }

        if (sequelEntries?.length) {
            if (mode === 'check') {
                entries = [...entries, ...sequelEntries]
            } else {
                entries = entries.filter(entry => !sequelEntries.find(sequel => sequel.link === entry.link))
            }
        }

        // this gets entries without any episode limiting, and for batches
        const batchEntries = !mode && isBatch && (await this.single({ media, episode, ignoreQuality, mode: 'batch' })).filter(entry => {
            return !epNumRx.test(entry.title)
        })

        if (batchEntries?.length) {
            entries = [...entries, ...batchEntries]
        }

        // some archaic shows only have shit DVD's in weird qualities, so try to look up without any quality restrictions when there are no results
        if (!entries.length && !ignoreQuality && !mode) {
            entries = await this.single({ media, episode, ignoreQuality: true })
        }
        return entries
    }

    /** @type {import('./types.js').SearchFunction} */
    async batch (opts) {
        return [] // not going to bother
    }

    /** @type {import('./types.js').SearchFunction} */
    async movie (opts) {
        return [] // not going to bother
    }
}()