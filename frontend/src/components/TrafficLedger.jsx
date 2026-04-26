const DIRECTION_LABELS = {
  incoming: 'IN',
  outgoing: 'OUT',
  listen: 'LISTEN',
  flow: 'FLOW',
};

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatTime(value) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) return '--:--:--';
  return date.toLocaleTimeString();
}

function endpoint(ip, port) {
  if (!ip || ip === '-') return '-';
  if (port === undefined || port === null || port === '-') return ip;
  return `${ip}:${port}`;
}

export default function TrafficLedger({ events = [], limit = 18, compact = false }) {
  const rows = events.slice(0, limit);

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        Waiting for live flow samples from the agent.
      </div>
    );
  }

  return (
    <div className={`traffic-ledger ${compact ? 'compact' : ''}`}>
      <table className="traffic-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Dir</th>
            <th>Proto</th>
            <th>Source</th>
            <th>Destination</th>
            <th>State</th>
            <th>Packets</th>
            <th>Size</th>
            <th>Rate</th>
            <th>Queue</th>
            <th>Verdict</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((event) => {
            const direction = String(event.direction || 'flow').toLowerCase();
            const source = direction === 'outgoing'
              ? (event.sourceLabel || endpoint(event.localIp, event.localPort))
              : (event.sourceLabel || endpoint(event.remoteIp, event.remotePort));
            const destination = direction === 'outgoing'
              ? (event.destinationLabel || endpoint(event.remoteIp, event.remotePort))
              : (event.destinationLabel || endpoint(event.localIp, event.localPort));
            const severity = event.severity || 'success';

            return (
              <tr key={event.id} className={`traffic-row severity-${severity}`}>
                <td className="traffic-time">{formatTime(event.timestamp)}</td>
                <td>
                  <span className={`traffic-dir ${direction}`}>
                    {DIRECTION_LABELS[direction] || direction.toUpperCase()}
                  </span>
                </td>
                <td>{event.protocol || 'IP'}</td>
                <td className="traffic-endpoint">{source}</td>
                <td className="traffic-endpoint">{destination}</td>
                <td>{event.state || '-'}</td>
                <td>{event.packets === null || event.packets === undefined ? '-' : event.packets}</td>
                <td>{formatBytes(event.sizeBytes)}</td>
                <td>{Number(event.rateMbps || 0).toFixed(3)} Mbps</td>
                <td>{Number(event.recvQ || 0)}/{Number(event.sendQ || 0)}</td>
                <td>
                  <span className={`traffic-verdict ${severity}`}>
                    {event.reason || 'normal flow'}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
