import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import { Button, Card, EmptyState } from '../components/ui'

export default function NotFound() {
  return (
    <Card className="mx-auto mt-10 max-w-lg">
      <EmptyState
        icon={<Compass size={18} />}
        title="This page does not exist"
        description="The record or route you followed is not part of the workspace."
        action={
          <Link to="/">
            <Button variant="primary">Back to overview</Button>
          </Link>
        }
      />
    </Card>
  )
}
