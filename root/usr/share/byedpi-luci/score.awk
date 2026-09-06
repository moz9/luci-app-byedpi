# Input: id|stage|round|probe|ok|milliseconds|bytes|bytes_per_second
# Output: id|total|failed|slow|median|p95|jitter|min_rate|rounds|eligible
# POSIX awk: OpenWrt does not require GNU awk or a Node/Python runtime.
BEGIN { FS = OFS = "|" }
NF == 8 && $2 == stage {
    id = $1 + 0
    if (!(id in total)) ids[++count] = id
    total[id]++
    if (!$5) failed[id]++
    if ($4 == "download") {
        downloads[id]++
        if ($5 && (!rates[id] || $8 < rates[id])) rates[id] = $8 + 0
    } else if ($4 != "start") {
        if (!seen[id SUBSEP $3]++) rounds[id]++
        endpoints[id SUBSEP $4]++
        if ($5) {
            n[id]++
            latency[id SUBSEP n[id]] = $6 + 0
            if ($6 >= 1500) slow[id]++
        }
    }
}
function better(a, b, x, y) {
    x = failed[a] / total[a]; y = failed[b] / total[b]
    if (x != y) return x < y
    x = slow[a] / (n[a] ? n[a] : 1); y = slow[b] / (n[b] ? n[b] : 1)
    if (x != y) return x < y
    # Stable-phase measurements are grouped in 100 ms bands so tiny timing
    # differences do not outweigh useful transfer capacity. Fixed bands keep
    # the ordering transitive (pairwise "within N ms" comparisons do not).
    x = stage == "stable" ? int(p95[a] / 100) : p95[a]
    y = stage == "stable" ? int(p95[b] / 100) : p95[b]
    if (x != y) return x < y
    x = stage == "stable" ? int(jitter[a] / 100) : jitter[a]
    y = stage == "stable" ? int(jitter[b] / 100) : jitter[b]
    if (x != y) return x < y
    if (rates[a] != rates[b]) return rates[a] > rates[b]
    if (p95[a] != p95[b]) return p95[a] < p95[b]
    if (jitter[a] != jitter[b]) return jitter[a] < jitter[b]
    if (median[a] != median[b]) return median[a] < median[b]
    return a < b
}
END {
    for (z = 1; z <= count; z++) {
        id = ids[z]
        for (i = 2; i <= n[id]; i++) {
            v = latency[id SUBSEP i]; j = i - 1
            while (j > 0 && latency[id SUBSEP j] > v) {
                latency[id SUBSEP (j + 1)] = latency[id SUBSEP j]; j--
            }
            latency[id SUBSEP (j + 1)] = v
        }
        if (n[id]) {
            median[id] = latency[id SUBSEP int((n[id] + 1) / 2)]
            p95[id] = latency[id SUBSEP int((n[id] * 95 + 99) / 100)]
            jitter[id] = p95[id] - median[id]
        } else {
            median[id] = p95[id] = 999999
        }
        eligible[id] = (stage == "stable" && !failed[id] && rounds[id] >= 3 && n[id] >= 12 && p95[id] < 1500 && endpoints[id SUBSEP "youtube"] && endpoints[id SUBSEP "google"] && downloads[id] > 0 && rates[id] > 0)
    }
    for (i = 2; i <= count; i++) {
        v = ids[i]; j = i - 1
        while (j > 0 && better(v, ids[j])) { ids[j + 1] = ids[j]; j-- }
        ids[j + 1] = v
    }
    for (i = 1; i <= count; i++) {
        id = ids[i]
        print id, total[id], failed[id]+0, slow[id]+0, median[id], p95[id], jitter[id]+0, int(rates[id]), rounds[id]+0, eligible[id]+0
    }
}
