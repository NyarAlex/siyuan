import {hideElements} from "../ui/hideElements";
import {focusBlock, getEditorRange} from "../util/selection";
import {getFirstBlock, getLastBlock, getParentBlock} from "./getBlock";
import {foldBlocksRecursively, setFold} from "../util/blockFold";
import {insertEmptyBlock} from "../../block/util";
import {moveToDown, moveToUp} from "./move";
import {cycleTaskState} from "./list";
import {openAnnotationEditor} from "./annotation";
import {scrollCenter} from "../../util/highlightById";
import {countBlockWord} from "../../layout/status";
import {writeText} from "../util/compatibility";
import {fetchPost} from "../../util/fetch";
import {showMessage} from "../../dialog/message";
import {hasClosestByClassName, isInEmbedBlock} from "../util/hasClosest";
/// #if !MOBILE
import {openGlobalSearch} from "../../search/util";
/// #endif

// Fork: vim-style Normal mode (design: docs/fork/vim-mode.md, P0).
//
// Normal mode IS the native selected-block state — Esc already enters it and
// the selection highlight is the mode indicator. This module only extends the
// key table available while a block is selected; Insert mode (normal typing)
// is untouched. Guardrails: never intercept while composing (IME), with
// ⌘/⌃/⌥ held, in embeds, or when the editor is read-only.
//
// j/k and x are delegated to the native handlers by re-dispatching the
// equivalent key (ArrowDown/ArrowUp/Backspace) — those branches fully manage
// selection/undo themselves, so behavior stays byte-identical with the
// arrows. Everything else maps directly onto existing primitives.

let pendingG = 0;

const synth = (protyle: IProtyle, key: string) => {
    protyle.wysiwyg.element.dispatchEvent(new KeyboardEvent("keydown", {key, bubbles: true, cancelable: true}));
};

const selectSingle = (protyle: IProtyle, element: HTMLElement) => {
    hideElements(["select"], protyle);
    element.classList.add("protyle-wysiwyg--select");
    countBlockWord([element.getAttribute("data-node-id")], protyle.block.rootID);
    scrollCenter(protyle, element);
    focusBlock(element);
};

export const forkVimKeydown = (event: KeyboardEvent, protyle: IProtyle): boolean => {
    if (event.isComposing || event.metaKey || event.ctrlKey || event.altKey || protyle.disabled) {
        return false;
    }
    if (typeof event.key !== "string" || event.key.length !== 1) {
        // Arrows/Enter/Tab/Backspace/Esc/F-keys… stay fully native.
        return false;
    }
    const selectElements = Array.from(protyle.wysiwyg.element.querySelectorAll(".protyle-wysiwyg--select")) as HTMLElement[];
    if (selectElements.length === 0) {
        return false;
    }
    const block = selectElements[0];
    if (isInEmbedBlock(block)) {
        return false;
    }
    event.preventDefault();
    event.stopPropagation();
    const key = event.key;
    if (key !== "g") {
        pendingG = 0;
    }
    switch (key) {
        case "j":
            synth(protyle, "ArrowDown");
            return true;
        case "k":
            synth(protyle, "ArrowUp");
            return true;
        case "x":
            synth(protyle, "Backspace");
            return true;
        case "h": {
            let parent = getParentBlock(block) as HTMLElement;
            if (parent && parent.classList.contains("list")) {
                // outline intuition: the parent of a bullet is the parent
                // bullet, not the wrapping list container
                parent = getParentBlock(parent) as HTMLElement;
            }
            if (parent && !parent.classList.contains("protyle-wysiwyg")) {
                selectSingle(protyle, parent);
            }
            return true;
        }
        case "l": {
            if (block.getAttribute("fold") === "1") {
                setFold(protyle, block);
                return true;
            }
            let child: HTMLElement = null;
            if (block.classList.contains("li")) {
                child = (block.querySelector(":scope > .list > .li") ||
                    block.querySelector(":scope > [data-node-id]")) as HTMLElement;
            } else if (block.classList.contains("p")) {
                const sibling = block.nextElementSibling;
                if (sibling?.classList.contains("list")) {
                    child = sibling.querySelector(":scope > .li") as HTMLElement;
                }
            } else {
                child = block.querySelector(":scope > [data-node-id]") as HTMLElement;
            }
            if (child) {
                selectSingle(protyle, child);
            }
            return true;
        }
        case "g":
            if (Date.now() - pendingG < 800) {
                pendingG = 0;
                const first = getFirstBlock(protyle.wysiwyg.element.firstElementChild) as HTMLElement;
                if (first) {
                    selectSingle(protyle, first);
                }
            } else {
                pendingG = Date.now();
            }
            return true;
        case "G": {
            const last = getLastBlock(protyle.wysiwyg.element.lastElementChild) as HTMLElement;
            if (last) {
                selectSingle(protyle, last);
            }
            return true;
        }
        case "J":
            moveToDown(protyle, block, getEditorRange(protyle.wysiwyg.element));
            return true;
        case "K":
            moveToUp(protyle, block, getEditorRange(protyle.wysiwyg.element));
            return true;
        case "z":
            setFold(protyle, block);
            return true;
        case "Z":
            foldBlocksRecursively(protyle, selectElements);
            return true;
        case "o":
        case "O": {
            const position = key === "o" ? "afterend" : "beforebegin";
            protyle.wysiwyg.element.blur();
            // 阻止中文输入的残留(同原生选中态插块的处理)
            setTimeout(() => {
                insertEmptyBlock(protyle, position);
            }, 100);
            return true;
        }
        case "i":
        case "a":
            hideElements(["select"], protyle);
            focusBlock(block, undefined, key === "i");
            return true;
        case "t": {
            const listItem = block.classList.contains("li") ? block : hasClosestByClassName(block, "li");
            if (listItem) {
                cycleTaskState(protyle, listItem as HTMLElement);
            }
            return true;
        }
        case "m": {
            let target: HTMLElement = null;
            if (block.classList.contains("p") || block.getAttribute("data-type") === "NodeHeading") {
                target = block;
            } else if (block.classList.contains("li")) {
                target = block.querySelector(':scope > [data-type="NodeParagraph"]') as HTMLElement;
            }
            if (target) {
                openAnnotationEditor(protyle, target);
            }
            return true;
        }
        case "y": {
            const id = block.getAttribute("data-node-id");
            fetchPost("/api/block/getRefText", {id}, (response) => {
                writeText(`((${id} '${response.data}'))`);
                showMessage("已复制块引用", 2000);
            });
            return true;
        }
        case "/":
            /// #if !MOBILE
            openGlobalSearch(protyle.app, "", false);
            /// #endif
            return true;
        default:
            // Unbound printable keys are swallowed in Normal mode so a stray
            // keystroke can never leak into the content (design §3.4).
            return true;
    }
};
