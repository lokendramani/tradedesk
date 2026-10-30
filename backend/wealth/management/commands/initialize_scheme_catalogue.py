from django.core.management.base import BaseCommand, CommandError

from wealth.scheme_catalogue import CatalogueError, initialize_scheme_catalogue


class Command(BaseCommand):
    help = 'Initialize the shared AMFI scheme catalogue only when it is empty.'

    def handle(self, *args, **options):
        try:
            result = initialize_scheme_catalogue()
        except CatalogueError as exc:
            raise CommandError(str(exc)) from exc
        summary = result.get('reason') or f"inserted {result['inserted']} schemes"
        self.stdout.write(self.style.SUCCESS(f"{result['status']}: {summary}"))
