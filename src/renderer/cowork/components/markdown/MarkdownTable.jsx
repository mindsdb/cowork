// Plain styled HTML table for GFM tables. mdb-ai's full version has
// expand-to-modal + CSV export tied to its conversation API; we keep
// just the visual half here. Add the modal/export later if needed.

export function MarkdownTable(props) {
  return (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-body" {...props} />
    </div>
  );
}

export const TableHead = (props) => (
  <th
    className="border-0 border-b border-solid border-line pl-0 pr-4 py-2.5 text-left font-body text-[13px] font-semibold text-ink"
    {...props}
  />
);

export const TableCell = (props) => (
  <td className="border-0 border-solid border-line pl-0 pr-4 py-2.5 align-top text-ink" {...props} />
);

export const TableRow = (props) => (
  <tr className="border-0 border-b border-solid border-line last:border-0" {...props} />
);
export const TableHeader = (props) => <thead {...props} />;
export const TableBody = (props) => <tbody {...props} />;
