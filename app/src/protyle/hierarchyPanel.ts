import {fetchPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {Constants} from "../constants";
import {escapeAnnotation} from "./annotationHub";

// Fork: Logseq/Tine-style hierarchy footer. Every document in a chain shows
// its place in the tree after the content — the ancestor chain (so a child
// doc knows what it belongs to) and its child docs — as a vertical list of
// clickable rows.
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
        // Ancestor doc ids are the .sy path segments above the current doc.
        const ancestorIds = this.protyle.path.split("/")
            .map(segment => segment.replace(/\.sy$/, ""))
            .filter(segment => segment && /^\d{14}-/.test(segment))
            .slice(0, -1);
        const finish = (ancestors: { id: string, title: string }[], children: { id: string, title: string }[]) => {
            if (ancestors.length === 0 && children.length === 0) {
                this.element.innerHTML = "";
                return;
            }
            const wysiwygStyle = this.protyle.wysiwyg.element.style;
            this.element.setAttribute("style",
                `padding:0 ${wysiwygStyle.paddingRight || "16px"} 48px ${wysiwygStyle.paddingLeft || "24px"}`);
            const row = (doc: { id: string, title: string }, cls: string, icon: string) =>
                `<div class="b3-list-item fork-hierarchy__row ${cls}" data-doc-id="${doc.id}">
    <svg class="fork-hierarchy__arrow"><use xlink:href="#${icon}"></use></svg>
    <span class="b3-list-item__text">${escapeAnnotation(doc.title)}</span>
</div>`;
            this.element.innerHTML = '<div class="fork-hierarchy__title">层级 Hierarchy</div>' +
                ancestors.map(doc => row(doc, "fork-hierarchy__row--up", "iconUp")).join("") +
                children.map(doc => row(doc, "fork-hierarchy__row--down", "iconDown")).join("");
        };
        const fetchChildren = (ancestors: { id: string, title: string }[]) => {
            fetchPost("/api/filetree/listDocsByPath", {
                notebook: this.protyle.notebookId,
                path: this.protyle.path,
                app: Constants.SIYUAN_APPID,
            }, (response) => {
                const children = ((response?.data?.files || []) as { id: string, name: string }[])
                    .map(file => ({id: file.id, title: file.name.replace(/\.sy$/, "")}));
                finish(ancestors, children);
            });
        };
        if (ancestorIds.length === 0) {
            fetchChildren([]);
            return;
        }
        fetchPost("/api/query/sql", {
            stmt: `SELECT id, content FROM blocks WHERE type = 'd' AND id IN (${ancestorIds.map(id => `'${id}'`).join(",")})`,
        }, (response) => {
            const titles = new Map<string, string>();
            ((response.data || []) as { id: string, content: string }[]).forEach(doc => {
                titles.set(doc.id, doc.content);
            });
            // Keep path order: notebook root first, direct parent last.
            fetchChildren(ancestorIds.map(id => ({id, title: titles.get(id) || "(未索引)"})));
        });
    }

    public destroy() {
        this.element.remove();
    }
}
