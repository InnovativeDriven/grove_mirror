declare module "xlsx" {
    interface WorkSheet {
        [cell: string]: unknown;
    }
    interface WorkBook {
        SheetNames: string[];
        Sheets: Record<string, WorkSheet>;
    }
    interface Sheet2CSVOpts {
        skipHidden?: boolean;
    }
    interface ReadOpts {
        type: "buffer" | "base64" | "binary" | "string" | "array" | "file";
    }
    export function read(data: Buffer | Uint8Array, opts: ReadOpts): WorkBook;
    export const utils: {
        sheet_to_csv(sheet: WorkSheet, opts?: Sheet2CSVOpts): string;
    };
}
