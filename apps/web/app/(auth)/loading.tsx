export default function AuthLoading() {
  return (
    <div className="w-full max-w-2xl animate-pulse" aria-busy="true" aria-label="Loading">
      <div className="panel h-64 w-full" />
    </div>
  );
}
