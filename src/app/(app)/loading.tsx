export default function Loading() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading">
      <div className="card card-pad" style={{ height: 84, background: "linear-gradient(90deg,#f4f7f8,#fff,#f4f7f8)" }} />
      <div className="grid-4">{[1, 2, 3, 4].map((item) => <div key={item} className="card" style={{ height: 96 }} />)}</div>
      <div className="card" style={{ height: 280 }} />
    </div>
  );
}
