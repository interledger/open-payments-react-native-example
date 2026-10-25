import { Screen } from '../../components/Screen'
import { BudgetScreen } from '../../screens/BudgetScreen'

/** Budget tab: Model A — server holds the key; approve a budget once. */
export default function BudgetTab() {
  return (
    <Screen>
      <BudgetScreen />
    </Screen>
  )
}
