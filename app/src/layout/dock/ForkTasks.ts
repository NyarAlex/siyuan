import {Tab} from "../Tab";
import {Model} from "../Model";
import {setPanelFocus} from "../util";
import {getDockByType} from "../tabUtil";
import {fetchPost} from "../../util/fetch";
import {openFileById} from "../../editor/util";
import {Constants} from "../../constants";
import {App} from "../../index";
import {escapeAnnotation} from "../../protyle/annotationHub";

// Fork: task dock — every task item in the workspace grouped by state
// (DOING / TODO / DONE), with sub-tasks (task items nested under a task item)
// rendered as an indented tree under their parent. Click a row to jump.
// States come from native task-list data plus the fork's custom-task="doing"
// attribute, so this is a live filter over real blocks.

type TTaskState = "doing" | "todo" | "done";

interface ITaskNode {
    id: string;
    content: string;
    hpath: string;
    created: string;
    state: TTaskState;
    children: ITaskNode[];
}

const SECTIONS: { state: TTaskState, label: string }[] = [
    {state: "doing", label: "DOING 进行中"},
    {state: "todo", label: "TODO 待办"},
    {state: "done", label: "DONE 已完成"},
];

const STATE_ICONS: Record<TTaskState, string> = {
    doing: '<svg class="fork-tasks__icon fork-tasks__icon--doing"><use xlink:href="#iconUncheck"></use></svg>',
    todo: '<svg class="fork-tasks__icon"><use xlink:href="#iconUncheck"></use></svg>',
    done: '<svg class="fork-tasks__icon fork-tasks__icon--done"><use xlink:href="#iconCheck"></use></svg>',
};

export class ForkTasks extends Model {
    private element: Element;
    private listElement: HTMLElement;

    constructor(app: App, tab: Tab) {
        super({app});
        this.connect({
            id: tab.id,
            type: "forkTasks",
        });
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__forkTasks", "dockPanel");
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">任务</div>
    <span data-type="refresh" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.refresh}"><svg><use xlink:href='#iconRefresh'></use></svg></span>
    <span class="fn__space"></span>
    <span data-type="min" class="block__icon ariaLabel" data-position="north" aria-label="${window.siyuan.languages.min}"><svg><use xlink:href='#iconMin'></use></svg></span>
</div>
<div class="fn__flex-1 fork-tasks__list" style="overflow:auto;margin-bottom:8px"></div>`;
        this.listElement = this.element.querySelector(".fork-tasks__list");
        this.element.querySelector('[data-type="min"]').addEventListener("click", () => {
            getDockByType("forkTasks").toggleModel("forkTasks");
        });
        this.element.querySelector('[data-type="refresh"]').addEventListener("click", () => {
            this.update();
        });
        this.element.addEventListener("click", (event: MouseEvent) => {
            setPanelFocus(this.element);
            const item = (event.target as HTMLElement).closest("[data-node-id]");
            if (item) {
                openFileById({
                    app: this.app,
                    id: item.getAttribute("data-node-id"),
                    action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                });
            }
        });
        this.update();
        // Fork: no kernel push exists for task changes — refresh whenever the
        // panel becomes visible, plus a low-frequency poll while it stays
        // visible so checkbox flips show up without manual refreshes.
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.update();
                }
            });
        });
        observer.observe(this.listElement);
        window.setInterval(() => {
            if (this.listElement.isConnected && this.listElement.getClientRects().length > 0 && document.hasFocus()) {
                this.update();
            }
        }, 15000);
    }

    public update() {
        fetchPost("/api/query/sql", {
            stmt: "SELECT block_id FROM attributes WHERE name = 'custom-task' AND value = 'doing' LIMIT 2048",
        }, (attrResponse) => {
            const doingIds = new Set<string>((attrResponse.data || []).map((row: { block_id: string }) => row.block_id));
            fetchPost("/api/query/sql", {
                stmt: "SELECT id, parent_id, fcontent, hpath, markdown, created FROM blocks WHERE type = 'i' AND subtype = 't' ORDER BY updated DESC LIMIT 4096",
            }, (blockResponse) => {
                const rows = (blockResponse.data || []) as { id: string, parent_id: string, fcontent: string, hpath: string, markdown: string, created: string }[];
                const nodes = new Map<string, ITaskNode>();
                rows.forEach(row => {
                    const checked = /^\s*[*+-] \[[xX]\]/.test(row.markdown || "");
                    nodes.set(row.id, {
                        id: row.id,
                        content: row.fcontent,
                        hpath: row.hpath,
                        created: row.created,
                        state: checked ? "done" : (doingIds.has(row.id) ? "doing" : "todo"),
                        children: [],
                    });
                });
                // A sub-task's ancestry is li → list → parent li: resolve the
                // intermediate list blocks to find each task's parent task.
                const listIds = Array.from(new Set(rows.map(row => row.parent_id))).filter(Boolean);
                const resolve = (listParents: Map<string, string>) => {
                    const roots: ITaskNode[] = [];
                    rows.forEach(row => {
                        const node = nodes.get(row.id);
                        const parentLi = listParents.get(row.parent_id);
                        if (parentLi && nodes.has(parentLi)) {
                            nodes.get(parentLi).children.push(node);
                        } else {
                            roots.push(node);
                        }
                    });
                    nodes.forEach(node => {
                        node.children.sort((a, b) => a.created.localeCompare(b.created));
                    });
                    this.render(roots);
                };
                if (listIds.length === 0) {
                    resolve(new Map());
                    return;
                }
                fetchPost("/api/query/sql", {
                    stmt: `SELECT id, parent_id FROM blocks WHERE type = 'l' AND id IN (${listIds.map(id => `'${id}'`).join(",")}) LIMIT 8192`,
                }, (listResponse) => {
                    const listParents = new Map<string, string>();
                    ((listResponse.data || []) as { id: string, parent_id: string }[]).forEach(row => {
                        listParents.set(row.id, row.parent_id);
                    });
                    resolve(listParents);
                });
            });
        });
    }

    private render(roots: ITaskNode[]) {
        const renderNode = (node: ITaskNode, depth: number): string => {
            return `<div class="b3-list-item fork-tasks__item${node.state === "done" ? " fork-tasks__item--done" : ""}" data-node-id="${node.id}" style="padding-left:${8 + depth * 18}px">
    ${STATE_ICONS[node.state]}
    <span class="b3-list-item__text">${escapeAnnotation(node.content) || "<i>(空)</i>"}</span>
</div>` + node.children.map(child => renderNode(child, depth + 1)).join("");
        };
        this.listElement.innerHTML = SECTIONS.map(section => {
            const items = roots.filter(root => root.state === section.state);
            return `<div class="fork-taskhub__section fork-taskhub__section--${section.state}">
    <div class="fork-taskhub__head" style="padding:0 8px">${section.label}<span class="counter">${items.length}</span></div>
    ${items.map(item => `<div class="fork-tasks__group">
        ${renderNode(item, 0)}
        <div class="fork-tasks__path">${escapeAnnotation(item.hpath || "")}</div>
    </div>`).join("") || '<div class="b3-list--empty" style="padding:2px 8px">无</div>'}
</div>`;
        }).join("");
    }
}
