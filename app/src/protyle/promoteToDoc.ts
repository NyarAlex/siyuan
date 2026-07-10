import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {movePathTo} from "../util/pathName";
import {showMessage} from "../dialog/message";
import {transaction} from "./wysiwyg/transaction";
import {getContenteditableElement} from "./wysiwyg/getBlock";
import {escapeAnnotation} from "./annotationHub";

// Fork: "promote to sub-doc" — turns a bullet's subtree into a child document
// of a target doc, leaving a block-ref bullet at the original spot. The kernel
// li2Doc keeps the block ID for the new doc, so the ref (and any pre-existing
// refs to the bullet) point at the new document automatically.
//
// The default target is inferred from the outline: the first doc reference
// found on an ancestor bullet's own first line — the journal pattern, where
// progress notes sit under a [[project]] bullet. With no ancestor ref, the
// picker opens directly.

/** Nearest ancestor bullet's own-line block-ref target id, or null. */
const inferTargetRef = (liElement: HTMLElement): string | null => {
    let ancestor = liElement.parentElement?.closest(".li") as HTMLElement;
    while (ancestor) {
        const refSpan = ancestor.querySelector(':scope > [data-type="NodeParagraph"] span[data-type~="block-ref"]');
        if (refSpan?.getAttribute("data-id")) {
            return refSpan.getAttribute("data-id");
        }
        ancestor = ancestor.parentElement?.closest(".li") as HTMLElement;
    }
    return null;
};

/** Leave a ref bullet after the source li, then move the subtree kernel-side.
 *  Ordering is safe: li2Doc starts with FlushTxQueue(), so the queued insert
 *  transaction lands before the subtree is unlinked. */
const doPromote = (protyle: IProtyle, liElement: HTMLElement, notebook: string, targetPath: string) => {
    const liID = liElement.getAttribute("data-node-id");
    const text = getContenteditableElement(liElement)?.textContent.trim() || "未命名";
    const refLiID = Lute.NewNodeID();
    const refPID = Lute.NewNodeID();
    const subtype = liElement.getAttribute("data-subtype") === "o" ? "o" : "u";
    const marker = subtype === "o" ? liElement.getAttribute("data-marker") : "*";
    const actionHTML = subtype === "o"
        ? `<div contenteditable="false" class="protyle-action protyle-action--order" draggable="true">${marker}</div>`
        : '<div class="protyle-action" draggable="true"><svg><use xlink:href="#iconDot"></use></svg></div>';
    const html = `<div data-marker="${marker}" data-subtype="${subtype}" data-node-id="${refLiID}" data-type="NodeListItem" class="li">${actionHTML}<div data-node-id="${refPID}" data-type="NodeParagraph" class="p"><div contenteditable="true" spellcheck="false"><span data-type="block-ref" data-id="${liID}" data-subtype="d">${escapeAnnotation(text)}</span></div><div class="protyle-attr" contenteditable="false"></div></div><div class="protyle-attr" contenteditable="false"></div></div>`;
    liElement.insertAdjacentHTML("afterend", html);
    transaction(protyle, [{
        action: "insert",
        data: html,
        id: refLiID,
        previousID: liID,
    }], [{
        action: "delete",
        id: refLiID,
    }]);
    fetchPost("/api/filetree/li2Doc", {
        srcListItemID: liID,
        targetNoteBook: notebook,
        targetPath,
        pushMode: 0,
    }, () => {
        showMessage(`已升格为子文档:${text}`, 4000);
    });
};

const openPicker = (protyle: IProtyle, liElement: HTMLElement) => {
    movePathTo({
        title: "升格为子文档 · 选择上级文档",
        flashcard: false,
        cb: (toPath, toNotebook) => {
            doPromote(protyle, liElement, toNotebook[0], toPath[0]);
        },
    });
};

export const promoteListItem = (protyle: IProtyle, liElement: HTMLElement) => {
    const refID = inferTargetRef(liElement);
    if (!refID) {
        openPicker(protyle, liElement);
        return;
    }
    fetchPost("/api/block/getBlockInfo", {id: refID}, (response) => {
        if (!response.data?.path) {
            openPicker(protyle, liElement);
            return;
        }
        const text = getContenteditableElement(liElement)?.textContent.trim() || "";
        const dialog = new Dialog({
            title: "升格为子文档",
            width: "460px",
            content: `<div class="b3-dialog__content">
    将「${escapeAnnotation(text.substring(0, 40))}」及其子树移动为
    <b>「${escapeAnnotation(response.data.rootTitle || "")}」</b> 的子文档,并在原位置留下引用。
</div>
<div class="b3-dialog__action">
    <button class="b3-button b3-button--cancel">${window.siyuan.languages.cancel}</button><div class="fn__space"></div>
    <button class="b3-button b3-button--outline" data-type="pick">选择其他位置</button><div class="fn__space"></div>
    <button class="b3-button b3-button--text">${window.siyuan.languages.confirm}</button>
</div>`,
        });
        const buttons = dialog.element.querySelectorAll(".b3-button");
        buttons[0].addEventListener("click", () => {
            dialog.destroy();
        });
        buttons[1].addEventListener("click", () => {
            dialog.destroy();
            openPicker(protyle, liElement);
        });
        buttons[2].addEventListener("click", () => {
            dialog.destroy();
            doPromote(protyle, liElement, response.data.box, response.data.path);
        });
    });
};
