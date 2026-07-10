import {Dialog} from "../dialog";
import {fetchPost} from "../util/fetch";
import {openFileById} from "../editor/util";
import {Constants} from "../constants";
import {App} from "../index";
import {escapeAnnotation} from "./annotationHub";

// Fork: task aggregation hub — every task item in the workspace grouped by
// state (DOING / TODO / DONE), click to jump. States are read from native
// task-list data plus the fork's custom-task="doing" attribute, so this is a
// live filter over real blocks, not a display-only list.

type TTaskState = "doing" | "todo" | "done";

interface ITaskRow {
    id: string;
    content: string;
    hpath: string;
    state: TTaskState;
}

const SECTIONS: { state: TTaskState, label: string }[] = [
    {state: "doing", label: "DOING 进行中"},
    {state: "todo", label: "TODO 待办"},
    {state: "done", label: "DONE 已完成"},
];

export const openTaskHub = (app: App) => {
    fetchPost("/api/query/sql", {
        stmt: "SELECT block_id FROM attributes WHERE name = 'custom-task' AND value = 'doing' LIMIT 2048",
    }, (attrResponse) => {
        const doingIds = new Set<string>((attrResponse.data || []).map((row: { block_id: string }) => row.block_id));
        fetchPost("/api/query/sql", {
            stmt: "SELECT id, content, hpath, markdown FROM blocks WHERE type = 'i' AND subtype = 't' ORDER BY updated DESC LIMIT 4096",
        }, (blockResponse) => {
            const rows: ITaskRow[] = (blockResponse.data || []).map((block: { id: string, content: string, hpath: string, markdown: string }) => {
                const checked = /^\s*[*+-] \[[xX]\]/.test(block.markdown || "");
                return {
                    id: block.id,
                    content: block.content,
                    hpath: block.hpath,
                    state: checked ? "done" : (doingIds.has(block.id) ? "doing" : "todo"),
                } as ITaskRow;
            });
            const dialog = new Dialog({
                title: "任务",
                width: "72vw",
                height: "76vh",
                content: '<div class="fork-hub__results" style="height:100%;overflow:auto;padding:8px 16px"></div>',
            });
            const resultsElement = dialog.element.querySelector(".fork-hub__results") as HTMLElement;
            resultsElement.innerHTML = SECTIONS.map(section => {
                const items = rows.filter(row => row.state === section.state);
                return `<div class="fork-taskhub__section fork-taskhub__section--${section.state}">
    <div class="fork-taskhub__head">${section.label}<span class="counter">${items.length}</span></div>
    ${items.map(item => `<div class="b3-list-item fork-hub__result" data-node-id="${item.id}" style="flex-direction:column;align-items:stretch;height:auto;padding:6px 8px">
        <div class="b3-list-item__text" style="font-size:14px">${escapeAnnotation(item.content) || "<i>(空)</i>"}</div>
        <div style="font-size:10px;margin-top:2px;color:var(--b3-theme-on-surface-light)">${escapeAnnotation(item.hpath || "")}</div>
    </div>`).join("") || '<div class="b3-list--empty" style="padding:4px 8px">无</div>'}
</div>`;
            }).join("");
            resultsElement.addEventListener("click", (event) => {
                const item = (event.target as HTMLElement).closest(".fork-hub__result");
                if (item) {
                    openFileById({
                        app,
                        id: item.getAttribute("data-node-id"),
                        action: [Constants.CB_GET_FOCUS, Constants.CB_GET_CONTEXT],
                    });
                    dialog.destroy();
                }
            });
        });
    });
};
