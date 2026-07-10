import * as dayjs from "dayjs";
import {Dialog} from "../dialog";
import {fetchPost, fetchSyncPost} from "../util/fetch";
import {movePathTo} from "../util/pathName";
import {showMessage} from "../dialog/message";
import {replaceFileName} from "../editor/rename";
import {updateTransaction} from "./wysiwyg/transaction";
import {getContenteditableElement} from "./wysiwyg/getBlock";
import {escapeAnnotation} from "./annotationHub";

// Fork: "promote to sub-doc" — creates an EMPTY child document titled after
// the bullet's own line and turns that line into a block-ref to it, in place.
// Nothing moves: the bullet's children stay where they were written (the
// journal keeps the day's process), and the new thread page starts empty,
// aggregating everything through backlinks from day one.
//
// The default target parent is inferred from the outline: the first doc
// reference found on an ancestor bullet's own line — the journal pattern,
// where progress sits under a [[project]] bullet. With no resolvable ancestor
// ref the location picker opens directly.

/** Ancestor bullets' own-line block-ref target ids, nearest first. */
const collectAncestorRefIDs = (liElement: HTMLElement): string[] => {
    const ids: string[] = [];
    let ancestor = liElement.parentElement?.closest(".li") as HTMLElement;
    while (ancestor) {
        const refSpan = ancestor.querySelector(':scope > [data-type="NodeParagraph"] span[data-type~="block-ref"]');
        const id = refSpan?.getAttribute("data-id");
        if (id && !ids.includes(id)) {
            ids.push(id);
        }
        ancestor = ancestor.parentElement?.closest(".li") as HTMLElement;
    }
    return ids;
};

/** Create the empty child doc under parentHPath, then swap the bullet's own
 *  line for a dynamic ref to it. Children are untouched. */
const doPromote = (protyle: IProtyle, liElement: HTMLElement, notebook: string, parentHPath: string) => {
    const pElement = liElement.querySelector(':scope > [data-type="NodeParagraph"]') as HTMLElement;
    const editable = pElement ? getContenteditableElement(pElement) : null;
    if (!editable) {
        showMessage("该行没有可转换的文本", 4000, "error");
        return;
    }
    const title = replaceFileName(editable.textContent.trim()) || "未命名";
    fetchPost("/api/filetree/createDocWithMd", {
        notebook,
        path: `${parentHPath === "/" ? "" : parentHPath}/${title}`,
        markdown: "",
    }, (response) => {
        const newDocID = response.data as string;
        const oldHTML = pElement.outerHTML;
        editable.innerHTML = `<span data-type="block-ref" data-id="${newDocID}" data-subtype="d">${escapeAnnotation(title)}</span>`;
        pElement.setAttribute("updated", dayjs().format("YYYYMMDDHHmmss"));
        updateTransaction(protyle, pElement, oldHTML);
        showMessage(`已创建空子文档并转为引用:${title}`, 4000);
    });
};

const openPicker = (protyle: IProtyle, liElement: HTMLElement) => {
    movePathTo({
        title: "升格为子文档 · 选择上级文档",
        flashcard: false,
        cb: (toPath, toNotebook) => {
            fetchPost("/api/filetree/getHPathByPath", {
                notebook: toNotebook[0],
                path: toPath[0],
            }, (response) => {
                doPromote(protyle, liElement, toNotebook[0], (response.data as string) || "/");
            });
        },
    });
};

export const promoteListItem = async (protyle: IProtyle, liElement: HTMLElement) => {
    const refIDs = collectAncestorRefIDs(liElement);
    let target: { box: string, hpath: string, title: string } = null;
    if (refIDs.length > 0) {
        // Resolve via SQL rather than getBlockInfo: a dangling ref (target doc
        // deleted) must silently fall through to the next ancestor / the
        // picker instead of toasting a kernel not-found error.
        const response = await fetchSyncPost("/api/query/sql", {
            stmt: `SELECT b1.id AS refid, b2.box, b2.hpath, b2.content FROM blocks b1 JOIN blocks b2 ON b1.root_id = b2.id WHERE b1.id IN (${refIDs.map(id => `'${id}'`).join(",")})`,
        });
        const byID = new Map<string, { box: string, hpath: string, content: string }>();
        ((response.data || []) as { refid: string, box: string, hpath: string, content: string }[]).forEach(row => {
            byID.set(row.refid, row);
        });
        for (const refID of refIDs) {
            const row = byID.get(refID);
            if (row) {
                target = {box: row.box, hpath: row.hpath, title: row.content};
                break;
            }
        }
    }
    if (!target) {
        openPicker(protyle, liElement);
        return;
    }
    const text = getContenteditableElement(liElement)?.textContent.trim() || "";
    const dialog = new Dialog({
        title: "升格为子文档",
        width: "460px",
        content: `<div class="b3-dialog__content">
    在 <b>「${escapeAnnotation(target.title || "")}」</b> 下创建空子文档「${escapeAnnotation(text.substring(0, 40))}」,
    并将本行原地变为它的引用。<br><span class="ft__on-surface ft__smaller">子级内容保留在当前位置,不会移动。</span>
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
        doPromote(protyle, liElement, target.box, target.hpath);
    });
};
