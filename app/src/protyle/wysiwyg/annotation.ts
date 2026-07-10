import {fetchPost} from "../../util/fetch";
import {openGlobalSearch} from "../../search/util";
import {openAnnotationHub, renderMemoHTML} from "../annotationHub";

// Fork: Tine-style right-margin annotation column.
//
// A real-DOM overlay (one cell per paragraph/heading block) anchored inside
// .protyle-content, so @tags inside annotations are clickable — a CSS
// pseudo-element can't host sub-elements. The memo attribute that lute mirrors
// onto every [data-node-id] element remains the single source of truth; the
// overlay is rebuilt from the DOM whenever it changes (MutationObserver on
// memo/fold + childList, ResizeObserver for layout/padding changes). Cells are
// display-only chrome: clicking a @tag opens the aggregation hub, clicking
// anywhere else on a cell opens the inline editor below.
export class AnnotationColumn {
    private element: HTMLElement;
    private protyle: IProtyle;
    private mutationObserver: MutationObserver;
    private resizeObserver: ResizeObserver;
    private pending = false;

    constructor(protyle: IProtyle) {
        this.protyle = protyle;
        this.element = document.createElement("div");
        this.element.className = "fork-annotations";
        protyle.contentElement.append(this.element);
        this.element.addEventListener("click", (event: MouseEvent) => {
            this.click(event);
        });
        this.mutationObserver = new MutationObserver(() => {
            this.schedule();
        });
        this.mutationObserver.observe(protyle.wysiwyg.element, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["memo", "fold"],
        });
        this.resizeObserver = new ResizeObserver(() => {
            this.schedule();
        });
        this.resizeObserver.observe(protyle.wysiwyg.element);
        this.schedule();
    }

    public destroy() {
        this.mutationObserver.disconnect();
        this.resizeObserver.disconnect();
        this.element.remove();
    }

    private schedule() {
        if (this.pending) {
            return;
        }
        this.pending = true;
        requestAnimationFrame(() => {
            this.pending = false;
            this.render();
        });
    }

    private render() {
        const wysiwyg = this.protyle.wysiwyg.element;
        if (!wysiwyg.isConnected || !wysiwyg.classList.contains("protyle-wysiwyg--annocol")) {
            this.element.innerHTML = "";
            return;
        }
        const overlayRect = this.element.getBoundingClientRect();
        let html = "";
        wysiwyg.querySelectorAll('[data-node-id].p, [data-node-id][data-type="NodeHeading"]').forEach((block: HTMLElement) => {
            if (block.closest(".protyle-wysiwyg__embed")) {
                return; // embed previews are read-only mirrors of other blocks
            }
            const rect = block.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) {
                return; // folded / hidden
            }
            const memo = block.getAttribute("memo") || "";
            const top = Math.round(rect.top - overlayRect.top) + 2;
            const left = Math.round(rect.right - overlayRect.left) + 12;
            html += `<div class="fork-annotations__cell${memo ? "" : " fork-annotations__cell--empty"}" ` +
                `data-node-id="${block.getAttribute("data-node-id")}" style="top:${top}px;left:${left}px">` +
                (memo ? renderMemoHTML(memo) : "@标注") +
                "</div>";
        });
        this.element.innerHTML = html;
    }

    private click(event: MouseEvent) {
        const target = event.target as HTMLElement;
        const tagElement = target.closest(".fork-annotations__tag");
        if (tagElement) {
            event.preventDefault();
            event.stopPropagation();
            // Alt+click keeps the @tag directory (counts overview); a plain
            // click reuses the native tag-click experience — the global search
            // panel with its result list, preview pane, and saved queries.
            if (event.altKey) {
                openAnnotationHub(this.protyle.app, tagElement.textContent);
                return;
            }
            if (!window.siyuan.config.search.memo) {
                // The query lives in block memos — make sure that field is in
                // the search scope (persisted, same as toggling it in the
                // search panel's settings).
                window.siyuan.config.search.memo = true;
                fetchPost("/api/setting/setSearch", window.siyuan.config.search);
            }
            openGlobalSearch(this.protyle.app, tagElement.textContent, true, {method: 0} as Config.IUILayoutTabSearchConfig);
            return;
        }
        const cell = target.closest(".fork-annotations__cell") as HTMLElement;
        if (cell && !this.protyle.disabled) {
            event.preventDefault();
            event.stopPropagation();
            const block = this.protyle.wysiwyg.element.querySelector(
                `[data-node-id="${cell.getAttribute("data-node-id")}"]`) as HTMLElement;
            if (block) {
                openAnnotationEditor(this.protyle, block);
            }
        }
    }
}

export const openAnnotationEditor = (protyle: IProtyle, blockElement: HTMLElement) => {
    document.querySelector(".fork-annotation__input")?.remove();
    const id = blockElement.getAttribute("data-node-id");
    const blockRect = blockElement.getBoundingClientRect();
    const textarea = document.createElement("textarea");
    textarea.className = "fork-annotation__input b3-text-field";
    textarea.setAttribute("placeholder", "@标注");
    textarea.value = blockElement.getAttribute("memo") || "";
    // Fixed positioning in viewport coordinates, appended to <body>: immune to
    // which ancestor scrolls or is position:relative (absolute positioning
    // inside the scroll container drifted once the doc had been scrolled).
    // Clamped so the editor stays on screen for blocks near the edges.
    textarea.setAttribute("style",
        "position:fixed;z-index:220;box-sizing:border-box;" +
        `top:${Math.round(Math.min(Math.max(blockRect.top, 8), window.innerHeight - 140))}px;` +
        `left:${Math.round(Math.min(blockRect.right + 8, window.innerWidth - 224))}px;` +
        "width:212px;min-height:58px;resize:vertical;font-size:12px;line-height:18px;");
    let closed = false;
    const commit = () => {
        if (closed) {
            return;
        }
        closed = true;
        protyle.contentElement.removeEventListener("scroll", commit);
        const value = textarea.value.trim();
        if (value !== (blockElement.getAttribute("memo") || "")) {
            fetchPost("/api/attr/setBlockAttrs", {id, attrs: {memo: value}});
        }
        textarea.remove();
    };
    // A fixed-position editor must not float away from its block — commit as
    // soon as the doc scrolls.
    protyle.contentElement.addEventListener("scroll", commit, {passive: true});
    textarea.addEventListener("blur", commit);
    textarea.addEventListener("keydown", (keyEvent: KeyboardEvent) => {
        keyEvent.stopPropagation();
        if (keyEvent.key === "Enter" && !keyEvent.shiftKey && !keyEvent.isComposing) {
            keyEvent.preventDefault();
            commit();
        } else if (keyEvent.key === "Escape") {
            keyEvent.preventDefault();
            closed = true;
            protyle.contentElement.removeEventListener("scroll", commit);
            textarea.remove();
        }
    });
    document.body.append(textarea);
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
};
