import { Compass } from 'lucide-react';
import { ButtonLink } from '../components/ui/button';
import { Empty } from '../components/ui/empty';
export function NotFound() {
  return <Empty icon={Compass} action={<ButtonLink to="/" variant="primary">Go to the inbox</ButtonLink>}>There's nothing at this address.</Empty>;
}
