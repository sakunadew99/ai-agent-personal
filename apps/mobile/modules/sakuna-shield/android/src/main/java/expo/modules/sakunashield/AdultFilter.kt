package expo.modules.sakunashield

/**
 * Built-in adult-site filter used when a blocklist has "Adult sites blocking" on.
 * Two checks: well-known adult domains (subdomains included) and unambiguous words in the address.
 * Words are chosen to avoid false hits on ordinary sites (no "sex", which matches "essex"/"sussex").
 * It is a best-effort list, not a complete one: users can add more domains or keywords to any blocklist.
 */
object AdultFilter {
  private val DOMAINS = setOf(
    "pornhub.com", "xvideos.com", "xnxx.com", "xhamster.com", "xhamster.desi", "redtube.com", "youporn.com",
    "tube8.com", "spankbang.com", "eporner.com", "txxx.com", "hqporner.com", "porntrex.com", "youjizz.com",
    "beeg.com", "tnaflix.com", "drtuber.com", "sunporno.com", "porn.com", "pornone.com", "4tube.com",
    "fapster.xxx", "motherless.com", "ixxx.com", "thumbzilla.com", "porndig.com", "pornhat.com", "anysex.com",
    "hclips.com", "upornia.com", "vjav.com", "javhd.com", "jav.guru", "missav.com", "javlibrary.com",
    "nhentai.net", "hentaihaven.xxx", "hanime.tv", "rule34.xxx", "e-hentai.org", "exhentai.org", "gelbooru.com",
    "chaturbate.com", "stripchat.com", "bongacams.com", "livejasmin.com", "cam4.com", "camsoda.com", "myfreecams.com",
    "onlyfans.com", "fansly.com", "manyvids.com", "clips4sale.com", "brazzers.com", "bangbros.com", "realitykings.com",
    "naughtyamerica.com", "playboy.com", "erome.com", "efukt.com", "heavy-r.com", "literotica.com", "imagefap.com",
    "porntube.com", "pornoxo.com", "lobstertube.com", "xozilla.com", "pornky.com", "hdzog.com", "porngo.com",
  )

  private val WORDS = listOf(
    "porn", "xxx", "hentai", "xvideo", "xnxx", "xhamster", "nsfw", "onlyfans", "camgirl", "milf", "nude", "nudes",
    "rule34", "brazzers", "redtube", "youporn", "chaturbate", "stripchat", "erotic", "fetish", "blowjob", "pussy",
  )

  /** host is a normalized domain; text is the full address-bar text, lower-case. */
  fun matches(host: String, text: String): Boolean =
    ShieldStore.domainMatches(host, DOMAINS) || host.endsWith(".xxx") || host.endsWith(".porn") || host.endsWith(".adult") ||
      WORDS.any { text.contains(it) }
}
