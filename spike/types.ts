export type Task = { id: string; title: string; done: boolean; owner_id: string };
export type Note = { id: string; title: string; body: string; owner_id: string };
export type List = { id: string; name: string; owner_id: string };
export type Item = { id: string; title: string; done: boolean; list_id: string };
