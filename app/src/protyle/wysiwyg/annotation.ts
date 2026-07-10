import {fetchPost} from "../../util/fetch";

// Fork: Tine-style right-margin annotation column.
//
// Display is pure CSS: lute already mirrors every block's `memo` IAL attribute
// onto its [data-node-id] element, and _attr.scss renders it in the reserved
// right gutter via ::after (see protyle-wysiwyg--annocol). This module only
// handles interaction: a click in the gutter zone of a block opens a small
// textarea overlay whose value is written back to the block's memo attribute —
// the kernel then broadcasts updateAttrs, which refreshes the DOM (and thus
// the CSS column) everywhere, including other windows.

const BLOCK_SELECTOR = '[data-node-id].p, [data-node-id][data-type="NodeHeading"]';

export const annotationClick = (event: MouseEvent & { target: HTMLElement }, protyle: IProtyle): boolean => {
    if (protyle.disabled ||
        !protyle.wysiwyg.element.classList.contains("protyle-wysiwyg--annocol")) {
        return false;
    }
    if (!(event.target instanceof Element)) {
        return false;
    }
    const blockElement = event.target.closest(BLOCK_SELECTOR) as HTMLElement;
    if (!blockElement || !protyle.wysiwyg.element.contains(blockElement)) {
        return false;
    }
    // A click on the ::after gutter text targets the block element itself but
    // lands beyond its right edge; clicks inside the content column are not ours.
    if (event.clientX < blockElement.getBoundingClientRect().right + 4) {
        return false;
    }
    openAnnotationEditor(protyle, blockElement);
    event.preventDefault();
    event.stopPropagation();
    return true;
};

export const openAnnotationEditor = (protyle: IProtyle, blockElement: HTMLElement) => {
    document.querySelector(".fork-annotation__input")?.remove();
    const id = blockElement.getAttribute("data-node-id");
    const blockRect = blockElement.getBoundingClientRect();
    const textarea = document.createElement("textarea");
    textarea.className = "fork-annotation__input b3-text-field";
    textarea.setAttribute("placeholder", "#标注");
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
