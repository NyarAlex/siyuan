import {fetchPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {Constants} from "../constants";
import {escapeAnnotation} from "./annotationHub";

// Fork: Logseq-style hierarchy footer — the current document's child docs
// rendered as clickable chips after the content, so the sub-tree is visible
// without the file tree.
export class HierarchyPanel {
    public element: HTMLElement;
    private protyle: IProtyle;

    constructor(protyle: IProtyle) {
        this.protyle = protyle;
        this.element = document.createElement("div");
        this.element.className = "fork-hierarchy";
        protyle.contentElement.append(this.element);
        this.element.addEventListener("click", (event) => {
            const item = (event.target as HTMLElement).closest("[data-doc-id]") as HTMLElement;
            if (item) {
                openFileById({
                    app: this.protyle.app,
                    id: item.getAttribute("data-doc-id"),
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_SCROLL],
                });
            }
        });
    }

    public render() {
        // Only real document editors (tabs with a title) get the footer — not
        // backlink previews, embeds, or the search preview.
        if (!this.protyle.options.render.title || !this.protyle.notebookId || !this.protyle.path) {
            this.element.innerHTML = "";
            return;
        }
        fetchPost("/api/filetree/listDocsByPath", {
            notebook: this.protyle.notebookId,
            path: this.protyle.path,
            app: Constants.SIYUAN_APPID,
        }, (response) => {
            const files = (response?.data?.files || []) as { id: string, name: string }[];
            if (files.length === 0) {
                this.element.innerHTML = "";
                return;
            }
            const wysiwygStyle = this.protyle.wysiwyg.element.style;
            this.element.setAttribute("style",
                `padding:0 ${wysiwygStyle.paddingRight || "16px"} 48px ${wysiwygStyle.paddingLeft || "24px"}`);
            this.element.innerHTML = `<div class="fork-hierarchy__title">子文档 · ${files.length}</div>` +
                files.map(file => `<span class="b3-chip b3-chip--middle fork-hierarchy__item" data-doc-id="${file.id}">${escapeAnnotation(file.name.replace(/\.sy$/, ""))}</span>`).join("");
        });
    }

    public destroy() {
        this.element.remove();
    }
}
