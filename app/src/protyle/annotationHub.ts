import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {Constants} from "../constants";
import {App} from "../index";

// Fork: annotation-layer tags. `@xxx` tokens inside a block's memo attribute
// form their own lightweight tag system, deliberately separate from SiYuan's
// content #tags — memos are the user's meta layer over source material, and
// the two must not pollute each other's index.
export const ANNOTATION_TAG_REGEX = /@[^\s@,，。;；:：!！?？()（）[\]【】]+/g;

export const escapeAnnotation = (text: string) => text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** memo text → HTML with @tags wrapped as clickable chips. */
export const renderMemoHTML = (memo: string) => {
    let out = "";
    let last = 0;
    for (const match of Array.from(memo.matchAll(ANNOTATION_TAG_REGEX))) {
        out += escapeAnnotation(memo.slice(last, match.index));
        out += `<span class="fork-annotations__tag">${escapeAnnotation(match[0])}</span>`;
        last = match.index + match[0].length;
    }
    out += escapeAnnotation(memo.slice(last));
    return out;
};

const ALL_TAG = "全部标注";

interface IAnnotationRow {
    id: string;
    memo: string;
}

/** The aggregation hub: every @tag found across all block memos, with the
 *  annotated blocks listed per tag. Click a row to jump to its block. */
export const openAnnotationHub = (app: App, preselect?: string) => {
    fetchPost("/api/query/sql", {
        stmt: "SELECT block_id, value FROM attributes WHERE name = 'memo' AND value != '' LIMIT 4096",
    }, (response) => {
        const rows: IAnnotationRow[] = (response.data || []).map((item: { block_id: string, value: string }) => ({
            id: item.block_id,
            memo: item.value,
        }));
        const byTag = new Map<string, IAnnotationRow[]>();
        byTag.set(ALL_TAG, rows);
        rows.forEach(row => {
            const seen = new Set<string>();
            for (const match of Array.from(row.memo.matchAll(ANNOTATION_TAG_REGEX))) {
                if (seen.has(match[0])) {
                    continue;
                }
                seen.add(match[0]);
                if (!byTag.has(match[0])) {
                    byTag.set(match[0], []);
                }
                byTag.get(match[0]).push(row);
            }
        });
        const tags = Array.from(byTag.keys()).filter(item => item !== ALL_TAG)
            .sort((a, b) => byTag.get(b).length - byTag.get(a).length || a.localeCompare(b));
        tags.unshift(ALL_TAG);

        const dialog = new Dialog({
            title: "标注",
            width: "82vw",
            height: "76vh",
            content: `<div class="fn__flex" style="height:100%;overflow:hidden">
    <ul class="b3-list b3-list--background fork-hub__tags" style="width:220px;flex-shrink:0;overflow:auto;border-right:1px solid var(--b3-border-color);padding:8px 0"></ul>
    <div class="fork-hub__results" style="flex:1;overflow:auto;padding:8px 16px"></div>
</div>`,
        });
        const tagsElement = dialog.element.querySelector(".fork-hub__tags") as HTMLElement;
        const resultsElement = dialog.element.querySelector(".fork-hub__results") as HTMLElement;
        tagsElement.innerHTML = tags.map(tag => `<li class="b3-list-item" data-tag="${escapeAnnotation(tag)}">
    <span class="b3-list-item__text">${escapeAnnotation(tag)}</span>
    <span class="counter">${byTag.get(tag).length}</span>
</li>`).join("");

        const renderResults = (tag: string) => {
            tagsElement.querySelectorAll("li").forEach(item => {
                item.classList.toggle("b3-list-item--focus", item.getAttribute("data-tag") === tag);
            });
            const entries = byTag.get(tag) || [];
            if (entries.length === 0) {
                resultsElement.innerHTML = '<ul class="b3-list--empty">无匹配的标注</ul>';
                return;
            }
            const ids = entries.map(entry => `'${entry.id}'`).join(",");
            fetchPost("/api/query/sql", {
                stmt: `SELECT id, content, hpath FROM blocks WHERE id IN (${ids}) LIMIT 4096`,
            }, (blockResponse) => {
                const info = new Map<string, { content: string, hpath: string }>();
                (blockResponse.data || []).forEach((block: { id: string, content: string, hpath: string }) => {
                    info.set(block.id, block);
                });
                resultsElement.innerHTML = entries.map(entry => {
                    const block = info.get(entry.id);
                    return `<div class="b3-list-item fork-hub__result" data-node-id="${entry.id}" style="flex-direction:column;align-items:stretch;height:auto;padding:6px 8px">
    <div class="b3-list-item__text" style="font-size:14px">${block ? (escapeAnnotation(block.content) || "<i>(空块)</i>") : "<i>(块不存在或尚未索引)</i>"}</div>
    <div style="font-size:12px;margin-top:2px">${renderMemoHTML(entry.memo)}</div>
    <div style="font-size:10px;margin-top:2px;color:var(--b3-theme-on-surface-light)">${block ? escapeAnnotation(block.hpath || "") : ""}</div>
</div>`;
                }).join("");
            });
        };

        tagsElement.addEventListener("click", (event) => {
            const item = (event.target as HTMLElement).closest("li");
            if (item) {
                renderResults(item.getAttribute("data-tag"));
            }
        });
        resultsElement.addEventListener("click", (event) => {
            const target = event.target as HTMLElement;
            const tagElement = target.closest(".fork-annotations__tag");
            if (tagElement && byTag.has(tagElement.textContent)) {
                renderResults(tagElement.textContent);
                return;
            }
            const item = target.closest(".fork-hub__result");
            if (item) {
                openFileById({
                    app,
                    id: item.getAttribute("data-node-id"),
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                });
                dialog.destroy();
            }
        });
        renderResults(preselect && byTag.has(preselect) ? preselect : ALL_TAG);
    });
};
