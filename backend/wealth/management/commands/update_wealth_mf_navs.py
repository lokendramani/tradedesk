from django.core.management.base import BaseCommand, CommandError

from wealth.nav_updates import NAVUpdateBusy, run_amfi_nav_update
from wealth.models import WealthMFNAVUpdateRun


class Command(BaseCommand):
    help = 'Update latest AMFI NAV history for schemes currently held in Wealth.'

    def handle(self, *args, **options):
        try:
            result = run_amfi_nav_update(trigger_type='MANAGEMENT_COMMAND')
        except NAVUpdateBusy as exc:
            raise CommandError(str(exc)) from exc

        self.stdout.write(
            f"AMFI NAV update {result['status']}: {result['held_schemes']} held schemes, "
            f"{result['inserted']} inserted, {result['updated']} updated, "
            f"{result['skipped']} skipped, {result['failed']} failed."
        )
        if result['status'] == WealthMFNAVUpdateRun.Status.FAILED:
            raise CommandError(result['error_summary'] or 'AMFI NAV update failed.')
