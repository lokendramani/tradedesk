from django.core.management.base import BaseCommand, CommandError

from wealth.scheme_catalogue import CatalogueError, refresh_scheme_catalogue


class Command(BaseCommand):
    help = 'Download AMFI and incrementally refresh the shared scheme catalogue.'

    def handle(self, *args, **options):
        try:
            result = refresh_scheme_catalogue()
        except CatalogueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(self.style.SUCCESS(
            'Refresh complete: {inserted} added, {updated} updated, {unchanged} unchanged, '
            '{rejected} rejected.'.format(**result)))
