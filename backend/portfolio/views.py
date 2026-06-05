from rest_framework import generics, permissions
from .models import Portfolio
from .serializers import PortfolioSerializer

class PortfolioListCreateView(generics.ListCreateAPIView):
    serializer_class   = PortfolioSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        user = self.request.user
        if user.role == 'ADMIN' or user.is_staff:
            user_id = self.request.query_params.get('user_id')
            if user_id:
                return Portfolio.objects.filter(user_id=user_id)
            return Portfolio.objects.all()
        return Portfolio.objects.filter(user=user)

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

class PortfolioDetailView(generics.RetrieveUpdateDestroyAPIView):
    serializer_class   = PortfolioSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Portfolio.objects.filter(user=self.request.user)