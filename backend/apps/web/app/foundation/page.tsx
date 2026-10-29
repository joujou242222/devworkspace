import Status from '../status';
export const dynamic = 'force-dynamic';
export default function Page() {
  return (
    <>
      <h1>DevWorkspace — Phase 1 foundation</h1>
      <p>
        Repository and compatibility work only. Product features and professional design are not
        implemented.
      </p>
      <Status />
      <p>
        <a href="/experiment">Isolated authentication compatibility experiment</a>
      </p>
    </>
  );
}
