import { HostRouteBootstrapBoundary } from "@/components/host-route-bootstrap-boundary";
import { FleetScreen } from "@/screens/fleet/fleet-screen";

export default function FleetRoute() {
  return (
    <HostRouteBootstrapBoundary>
      <FleetScreen />
    </HostRouteBootstrapBoundary>
  );
}
